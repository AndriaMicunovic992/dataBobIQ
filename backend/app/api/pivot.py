from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.metadata import Dataset, DatasetRelationship
from app.schemas.pivot import PivotRequest, PivotResponse
from app.services.pivot_engine import execute_pivot
from app.duckdb_engine import register_dataset, _registered_datasets

logger = logging.getLogger(__name__)

router = APIRouter(tags=["pivot"])


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

    # Ensure the dataset's DuckDB view is registered
    if body.dataset_id not in _registered_datasets:
        ds_result = await db.execute(
            select(Dataset).where(Dataset.id == body.dataset_id, Dataset.status == "active")
        )
        ds = ds_result.scalar_one_or_none()
        if ds and ds.parquet_path:
            try:
                await asyncio.to_thread(register_dataset, ds.id, ds.parquet_path)
                logger.info("Lazily registered DuckDB view for dataset %s", ds.id)
            except FileNotFoundError as exc:
                logger.warning(
                    "Dataset %s parquet missing; marking as missing_parquet: %s",
                    ds.id, exc,
                )
                ds.status = "missing_parquet"
                await db.commit()
                raise HTTPException(
                    status_code=410,
                    detail=(
                        f"Dataset '{ds.name}' is missing its data file and needs to be "
                        f"re-uploaded. The parquet file at {ds.parquet_path} no longer exists."
                    ),
                ) from exc
            except Exception as exc:
                logger.warning("Failed to register dataset %s: %s", ds.id, exc)

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

    try:
        response = await asyncio.to_thread(
            execute_pivot,
            request=body,
            dataset_id=body.dataset_id,
            scenario_ids=body.scenario_ids or None,
            relationships=relationships,
        )
    except Exception as exc:
        logger.exception("Pivot query failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Pivot query failed: {exc}") from exc

    return response
