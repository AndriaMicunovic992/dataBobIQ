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
from app.duckdb_engine import execute_query, register_dataset, view_name_for, _registered_datasets

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

    # Build source_to_canonical rename map for all involved datasets,
    # VALIDATED against actual DuckDB view columns. We only translate names
    # when the source name is NOT in the view AND the target name IS — this
    # avoids breaking joins where mapping_config has stale entries that were
    # never actually applied to the Parquet (because dedup cleared the
    # canonical_name and materialization respected that).
    involved_ds_ids = {body.dataset_id}
    if body.join_dimensions:
        involved_ds_ids.update(body.join_dimensions.values())

    # DESCRIBE each involved view once to get actual columns
    view_columns_by_ds: dict[str, set[str]] = {}
    for ds_id in involved_ds_ids:
        try:
            view = view_name_for(ds_id)
            view_columns_by_ds[ds_id] = {
                r["column_name"] for r in execute_query(
                    f"SELECT column_name FROM (DESCRIBE {view})"
                )
            }
        except Exception:
            logger.warning("Could not DESCRIBE view for dataset %s", ds_id, exc_info=True)
            view_columns_by_ds[ds_id] = set()

    def _add_rename(ds_id: str, src: str, tgt: str, ds_map: dict[str, str]) -> None:
        """Only register src→tgt if src is missing and tgt exists in the view."""
        if not src or not tgt or src == tgt or src in ds_map:
            return
        view_cols = view_columns_by_ds.get(ds_id, set())
        # If we couldn't introspect the view, keep the old behavior (best effort)
        if not view_cols:
            ds_map[src] = tgt
            return
        # Only translate when src isn't actually in the view but tgt is
        if src not in view_cols and tgt in view_cols:
            ds_map[src] = tgt

    col_result = await db.execute(
        select(DatasetColumn).where(
            DatasetColumn.dataset_id.in_(involved_ds_ids)
        )
    )
    all_cols = col_result.scalars().all()
    source_to_canonical: dict[str, dict[str, str]] = {}
    for c in all_cols:
        if c.canonical_name and c.canonical_name != c.source_name:
            ds_map = source_to_canonical.setdefault(c.dataset_id, {})
            _add_rename(c.dataset_id, c.source_name, c.canonical_name, ds_map)

    # Fallback: check mapping_config JSON for renames that may have been
    # applied during materialization. _add_rename validates against the
    # actual view, so stale mapping_config entries are ignored.
    ds_result = await db.execute(
        select(Dataset).where(Dataset.id.in_(involved_ds_ids))
    )
    for ds in ds_result.scalars().all():
        if ds.mapping_config:
            ds_map = source_to_canonical.setdefault(ds.id, {})
            for m in ds.mapping_config.get("mappings", []):
                _add_rename(ds.id, m.get("source", ""), m.get("target", ""), ds_map)

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
        for rel in all_rels:
            if (rel.source_dataset_id == body.dataset_id and rel.target_dataset_id in target_ds_ids) or \
               (rel.target_dataset_id == body.dataset_id and rel.source_dataset_id in target_ds_ids):
                relationships.append(rel)

        # Auto-heal relationship column names
        for rel in relationships:
            involved_ds_ids.add(rel.source_dataset_id)
            involved_ds_ids.add(rel.target_dataset_id)

        # Fetch any additional columns/mappings for relationship datasets not
        # already in our map (edge case: relationship references a dataset not
        # in join_dimensions).
        extra_ds_ids = involved_ds_ids - {body.dataset_id} - set(body.join_dimensions.values())
        if extra_ds_ids:
            for ds_id in extra_ds_ids:
                if ds_id not in view_columns_by_ds:
                    try:
                        view = view_name_for(ds_id)
                        view_columns_by_ds[ds_id] = {
                            r["column_name"] for r in execute_query(
                                f"SELECT column_name FROM (DESCRIBE {view})"
                            )
                        }
                    except Exception:
                        view_columns_by_ds[ds_id] = set()

            extra_col_result = await db.execute(
                select(DatasetColumn).where(DatasetColumn.dataset_id.in_(extra_ds_ids))
            )
            for c in extra_col_result.scalars().all():
                if c.canonical_name and c.canonical_name != c.source_name:
                    ds_map = source_to_canonical.setdefault(c.dataset_id, {})
                    _add_rename(c.dataset_id, c.source_name, c.canonical_name, ds_map)
            extra_ds_result = await db.execute(
                select(Dataset).where(Dataset.id.in_(extra_ds_ids))
            )
            for ds_extra in extra_ds_result.scalars().all():
                if ds_extra.mapping_config:
                    ds_map = source_to_canonical.setdefault(ds_extra.id, {})
                    for m_extra in ds_extra.mapping_config.get("mappings", []):
                        _add_rename(ds_extra.id, m_extra.get("source", ""), m_extra.get("target", ""), ds_map)

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

    # Auto-heal field names in the request itself. Stored widget configs or
    # stale frontend state may reference source_names that were renamed in
    # the DuckDB view.
    fact_map = source_to_canonical.get(body.dataset_id, {})

    if body.join_dimensions:
        dim_maps = {ds_id: source_to_canonical.get(ds_id, {}) for ds_id in set(body.join_dimensions.values())}

        # Translate row_dimensions
        new_rows = []
        for dim in body.row_dimensions:
            if dim in body.join_dimensions:
                ds_id = body.join_dimensions[dim]
                new_rows.append(dim_maps.get(ds_id, {}).get(dim, dim))
            else:
                new_rows.append(fact_map.get(dim, dim))
        body.row_dimensions = new_rows

        # Translate column_dimension
        if body.column_dimension:
            if body.column_dimension in body.join_dimensions:
                ds_id = body.join_dimensions[body.column_dimension]
                body.column_dimension = dim_maps.get(ds_id, {}).get(body.column_dimension, body.column_dimension)
            else:
                body.column_dimension = fact_map.get(body.column_dimension, body.column_dimension)

        # Translate filter keys
        if body.filters:
            new_filters = {}
            for col, vals in body.filters.items():
                if col in body.join_dimensions:
                    ds_id = body.join_dimensions[col]
                    new_filters[dim_maps.get(ds_id, {}).get(col, col)] = vals
                else:
                    new_filters[fact_map.get(col, col)] = vals
            body.filters = new_filters

        # Translate join_dimensions keys (the field names must match the view)
        new_join_dims = {}
        for dim_field, ds_id in body.join_dimensions.items():
            new_key = dim_maps.get(ds_id, {}).get(dim_field, dim_field)
            new_join_dims[new_key] = ds_id
        body.join_dimensions = new_join_dims
    else:
        # Fact-only query: translate row_dimensions and column_dimension
        if fact_map:
            body.row_dimensions = [fact_map.get(d, d) for d in body.row_dimensions]
            if body.column_dimension:
                body.column_dimension = fact_map.get(body.column_dimension, body.column_dimension)
            if body.filters:
                body.filters = {fact_map.get(k, k): v for k, v in body.filters.items()}

    # Translate measure fields (always from fact table)
    if fact_map:
        for measure in body.measures:
            if measure.field in fact_map:
                measure.field = fact_map[measure.field]

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
