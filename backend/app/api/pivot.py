from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.metadata import DatasetRelationship
from app.schemas.pivot import PivotRequest, PivotResponse
from app.services.pivot_engine import execute_pivot

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
        response = execute_pivot(
            request=body,
            dataset_id=body.dataset_id,
            scenario_ids=body.scenario_ids or None,
            relationships=relationships,
        )
    except Exception as exc:
        logger.exception("Pivot query failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Pivot query failed: {exc}") from exc

    return response
