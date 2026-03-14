from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.metadata import Model
from app.schemas.datasets import MetadataResponse
from app.services.metadata_svc import get_model_metadata

logger = logging.getLogger(__name__)

router = APIRouter(tags=["metadata"])


@router.get("/models/{model_id}/metadata", response_model=MetadataResponse)
async def get_metadata(
    model_id: str,
    db: AsyncSession = Depends(get_db),
) -> MetadataResponse:
    """Return all dimensions, measures, value lists, scenarios, and KPIs for a model.

    This is the primary bootstrap endpoint for the frontend. The response contains
    everything needed to populate filter dropdowns and pivot field selectors without
    loading raw data. Analytical stats (min/max/sum, unique values) are computed
    via DuckDB from the registered Parquet files.
    """
    result = await db.execute(select(Model).where(Model.id == model_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")

    try:
        metadata = await get_model_metadata(model_id=model_id, db=db)
    except Exception as exc:
        logger.exception("Failed to build metadata for model %s: %s", model_id, exc)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to build metadata: {exc}",
        ) from exc

    return metadata
