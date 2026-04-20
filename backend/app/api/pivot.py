from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.metadata import Dataset, DatasetColumn, DatasetRelationship
from app.schemas.pivot import PivotRequest, PivotResponse
from app.services.pivot_engine import execute_pivot
from app.services.scenario_engine import ensure_scenario_view
from app.duckdb_engine import register_dataset, _registered_datasets

logger = logging.getLogger(__name__)

router = APIRouter(tags=["pivot"])


async def _ensure_dataset_ready(db: AsyncSession, dataset_id: str) -> Dataset:
    """Verify the dataset exists, its parquet file is on disk, and its DuckDB view is registered.

    Handles the full matrix of failure modes that can happen after a redeploy
    or volume detach:

    * Dataset row missing in Postgres  → 404
    * ``parquet_path`` empty/None      → 410 (needs re-upload)
    * File missing on disk             → 410 + mark ``missing_parquet``
    * File present but view not yet    → register in this process
      registered (e.g. new worker       (and flip status back to ``active``
      thread, restart)                   if previously marked orphaned)

    Returns the (possibly updated) Dataset ORM instance.
    """
    ds = (
        await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    ).scalar_one_or_none()

    if ds is None:
        raise HTTPException(
            status_code=404,
            detail=f"Dataset {dataset_id} not found.",
        )

    if not ds.parquet_path:
        raise HTTPException(
            status_code=410,
            detail=(
                f"Dataset '{ds.name}' has no parquet file recorded. "
                f"Please re-upload the source file."
            ),
        )

    parquet_exists = Path(ds.parquet_path).exists()

    if not parquet_exists:
        logger.warning(
            "Dataset %s (%s): parquet missing at %s — marking missing_parquet",
            ds.id, ds.name, ds.parquet_path,
        )
        if ds.status != "missing_parquet":
            ds.status = "missing_parquet"
            await db.commit()
        raise HTTPException(
            status_code=410,
            detail=(
                f"Dataset '{ds.name}' is missing its data file and needs to be "
                f"re-uploaded. Expected parquet at: {ds.parquet_path}. "
                f"If this happened after a deploy, verify the DATA_DIR env var "
                f"points to a persistent volume (Railway: /app/data)."
            ),
        )

    # File is on disk. Make sure it's registered in DuckDB.
    if dataset_id not in _registered_datasets:
        try:
            await asyncio.to_thread(register_dataset, ds.id, ds.parquet_path)
            logger.info("Lazily registered DuckDB view for dataset %s", ds.id)
        except FileNotFoundError as exc:
            # Race: file was there moments ago but gone now.
            ds.status = "missing_parquet"
            await db.commit()
            raise HTTPException(
                status_code=410,
                detail=(
                    f"Dataset '{ds.name}' parquet file disappeared during "
                    f"registration: {exc}. Please re-upload."
                ),
            ) from exc
        except Exception as exc:
            logger.exception("Failed to register dataset %s: %s", ds.id, exc)
            raise HTTPException(
                status_code=500,
                detail=f"Failed to register dataset {ds.id}: {exc}",
            ) from exc

    # Recovered from an orphaned state → flip status back to active.
    if ds.status == "missing_parquet":
        ds.status = "active"
        await db.commit()
        logger.info("Dataset %s recovered from missing_parquet → active", ds.id)

    return ds


@router.post("/pivot", response_model=PivotResponse)
async def run_pivot(
    body: PivotRequest,
    db: AsyncSession = Depends(get_db),
) -> PivotResponse:
    """Execute a server-side pivot/aggregation query via DuckDB.

    Accepts a pivot configuration and returns aggregated results (10–500 rows).
    All computation happens in DuckDB; no full dataset is loaded into Python memory.
    """
    logger.info(
        "Pivot request dataset_id=%s row_dims=%s measures=%d join_dims=%s",
        body.dataset_id,
        body.row_dimensions,
        len(body.measures),
        body.join_dimensions,
    )

    # Ensure the fact dataset and any join-target datasets are ready.
    await _ensure_dataset_ready(db, body.dataset_id)
    if body.join_dimensions:
        for target_ds_id in set(body.join_dimensions.values()):
            if target_ds_id and target_ds_id != body.dataset_id:
                await _ensure_dataset_ready(db, target_ds_id)

    # Lazily register any scenario views referenced in the request. Without
    # this, the UNION ALL in the pivot SQL would fail in a worker thread that
    # hasn't yet seen the scenario parquet (e.g. right after a rule change).
    if body.scenario_ids:
        for sc_id in body.scenario_ids:
            try:
                await asyncio.to_thread(
                    ensure_scenario_view,
                    sc_id,
                    body.model_id,
                    settings.data_dir,
                )
            except ValueError as exc:
                raise HTTPException(
                    status_code=410,
                    detail=(
                        f"Scenario {sc_id} has no computed data. "
                        f"Open the scenario and add/edit a rule to trigger recompute, "
                        f"or POST to /api/scenarios/{sc_id}/recompute."
                    ),
                ) from exc
            except Exception as exc:
                logger.exception("Failed to register scenario view %s: %s", sc_id, exc)
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to register scenario view {sc_id}: {exc}",
                ) from exc

    # Look up relationships if cross-dataset dimensions are requested
    relationships = []
    if body.join_dimensions:
        target_ds_ids = set(body.join_dimensions.values())
        result = await db.execute(
            select(DatasetRelationship).where(
                DatasetRelationship.model_id == body.model_id,
            )
        )
        all_rels = result.scalars().all()
        # Filter to relationships connecting the fact dataset to the needed target datasets
        for rel in all_rels:
            if (rel.source_dataset_id == body.dataset_id and rel.target_dataset_id in target_ds_ids) or \
               (rel.target_dataset_id == body.dataset_id and rel.source_dataset_id in target_ds_ids):
                relationships.append(rel)

        # Auto-heal: stored relationships may reference source_names that were
        # renamed to canonical names during materialization. Detach from the
        # session before mutating so the resolved names aren't persisted on
        # commit — we want to translate for this query only, not rewrite
        # stored data.
        involved_ds_ids = {body.dataset_id}
        for rel in relationships:
            involved_ds_ids.add(rel.source_dataset_id)
            involved_ds_ids.add(rel.target_dataset_id)

        col_result = await db.execute(
            select(DatasetColumn).where(
                DatasetColumn.dataset_id.in_(involved_ds_ids)
            )
        )
        all_cols = col_result.scalars().all()
        source_to_canonical: dict[str, dict[str, str]] = {}
        for c in all_cols:
            if c.canonical_name and c.canonical_name != c.source_name:
                source_to_canonical.setdefault(c.dataset_id, {})[c.source_name] = c.canonical_name

        for rel in relationships:
            db.expunge(rel)
            src_map = source_to_canonical.get(rel.source_dataset_id, {})
            tgt_map = source_to_canonical.get(rel.target_dataset_id, {})
            if rel.source_column in src_map:
                logger.info(
                    "Auto-resolving relationship %s source_column '%s' → '%s'",
                    rel.id, rel.source_column, src_map[rel.source_column],
                )
                rel.source_column = src_map[rel.source_column]
            if rel.target_column in tgt_map:
                logger.info(
                    "Auto-resolving relationship %s target_column '%s' → '%s'",
                    rel.id, rel.target_column, tgt_map[rel.target_column],
                )
                rel.target_column = tgt_map[rel.target_column]

    try:
        response = await asyncio.to_thread(
            execute_pivot,
            request=body,
            dataset_id=body.dataset_id,
            scenario_ids=body.scenario_ids or None,
            relationships=relationships,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Pivot query failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Pivot query failed: {exc}") from exc

    return response
