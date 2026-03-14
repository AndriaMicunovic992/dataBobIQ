from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.metadata import Model
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
    """Delete a model and all associated data."""
    result = await db.execute(select(Model).where(Model.id == model_id))
    model = result.scalar_one_or_none()
    if model is None:
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")

    await db.delete(model)
    await db.commit()
    logger.info("Deleted model id=%s", model_id)
