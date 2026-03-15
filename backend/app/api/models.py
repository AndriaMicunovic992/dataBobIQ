from __future__ import annotations

import logging
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.duckdb_engine import unregister_dataset
from app.models.metadata import Dataset, Model
from app.schemas.models import ModelCreate, ModelResponse, ModelUpdate

logger = logging.getLogger(__name__)

router = APIRouter(tags=["models"])


@router.post("/models", response_model=ModelResponse, status_code=201)
async def create_model(
    body: ModelCreate,
    db: AsyncSession = Depends(get_db),
) -> ModelResponse:
    """Create a new model (workspace container)."""
    model = Model(**body.model_dump())
    db.add(model)
    await db.commit()
    await db.refresh(model)
    logger.info("Created model id=%s name=%s", model.id, model.name)
    return ModelResponse.model_validate(model)


@router.get("/models", response_model=list[ModelResponse])
async def list_models(
    db: AsyncSession = Depends(get_db),
) -> list[ModelResponse]:
    """Return all models."""
    result = await db.execute(select(Model).order_by(Model.created_at.desc()))
    models = result.scalars().all()
    return [ModelResponse.model_validate(m) for m in models]


@router.get("/models/{model_id}", response_model=ModelResponse)
async def get_model(
    model_id: str,
    db: AsyncSession = Depends(get_db),
) -> ModelResponse:
    """Return a single model by ID."""
    result = await db.execute(select(Model).where(Model.id == model_id))
    model = result.scalar_one_or_none()
    if model is None:
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")
    return ModelResponse.model_validate(model)


@router.put("/models/{model_id}", response_model=ModelResponse)
async def update_model(
    model_id: str,
    body: ModelUpdate,
    db: AsyncSession = Depends(get_db),
) -> ModelResponse:
    """Update model metadata."""
    result = await db.execute(select(Model).where(Model.id == model_id))
    model = result.scalar_one_or_none()
    if model is None:
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(model, field, value)

    await db.commit()
    await db.refresh(model)
    logger.info("Updated model id=%s", model_id)
    return ModelResponse.model_validate(model)


@router.delete("/models/{model_id}", status_code=204)
async def delete_model(
    model_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a model and all associated data including Parquet files and DuckDB views."""
    result = await db.execute(select(Model).where(Model.id == model_id))
    model = result.scalar_one_or_none()
    if model is None:
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")

    # Query datasets separately to avoid eager-loading issues
    ds_result = await db.execute(
        select(Dataset).where(Dataset.model_id == model_id)
    )
    datasets = ds_result.scalars().all()

    # Clean up DuckDB views and Parquet files for each dataset
    for dataset in datasets:
        try:
            unregister_dataset(dataset.id)
        except Exception as exc:
            logger.warning("Could not unregister DuckDB view for dataset %s: %s", dataset.id, exc)

        if dataset.parquet_path:
            try:
                p = Path(dataset.parquet_path)
                if p.exists():
                    p.unlink()
                    logger.info("Removed parquet file %s", p)
            except Exception as exc:
                logger.warning("Could not remove parquet file for dataset %s: %s", dataset.id, exc)

    # Remove the model's data directory (contains parquet + dimension files)
    model_data_dir = Path(settings.data_dir) / model_id
    if model_data_dir.exists():
        try:
            shutil.rmtree(model_data_dir)
            logger.info("Removed model data directory %s", model_data_dir)
        except Exception as exc:
            logger.warning("Could not remove model data dir %s: %s", model_data_dir, exc)

    # Remove uploaded files for each dataset
    upload_dir = Path(settings.upload_dir)
    for dataset in datasets:
        for f in upload_dir.glob(f"{dataset.id}_*"):
            try:
                f.unlink()
                logger.info("Removed upload file %s", f)
            except Exception as exc:
                logger.warning("Could not remove upload file %s: %s", f, exc)

    # ORM cascade handles all related DB rows (datasets, columns, scenarios, etc.)
    await db.delete(model)
    await db.commit()
    logger.info("Deleted model id=%s and all associated data", model_id)
