from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.metadata import KPIDefinition, Model
from app.schemas.kpis import (
    KPICreate,
    KPIEvalRequest,
    KPIEvalResponse,
    KPIResponse,
)
from app.services.kpi_engine import evaluate_kpis

logger = logging.getLogger(__name__)

router = APIRouter(tags=["kpis"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_kpi_or_404(kpi_id: str, db: AsyncSession) -> KPIDefinition:
    result = await db.execute(select(KPIDefinition).where(KPIDefinition.id == kpi_id))
    kpi = result.scalar_one_or_none()
    if kpi is None:
        raise HTTPException(status_code=404, detail=f"KPI {kpi_id} not found")
    return kpi


# ---------------------------------------------------------------------------
# KPI CRUD
# ---------------------------------------------------------------------------


@router.post("/models/{model_id}/kpis", response_model=KPIResponse, status_code=201)
async def create_kpi(
    model_id: str,
    body: KPICreate,
    db: AsyncSession = Depends(get_db),
) -> KPIResponse:
    """Create a KPI definition for a model."""
    result = await db.execute(select(Model).where(Model.id == model_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")

    kpi = KPIDefinition(model_id=model_id, **body.model_dump())
    db.add(kpi)
    await db.commit()
    await db.refresh(kpi)
    logger.info("Created KPI id=%s model_id=%s kpi_id=%s", kpi.id, model_id, kpi.kpi_id)
    return KPIResponse.model_validate(kpi)


@router.get("/models/{model_id}/kpis", response_model=list[KPIResponse])
async def list_kpis(
    model_id: str,
    db: AsyncSession = Depends(get_db),
) -> list[KPIResponse]:
    """List all KPI definitions for a model."""
    result = await db.execute(select(Model).where(Model.id == model_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")

    result = await db.execute(
        select(KPIDefinition)
        .where(KPIDefinition.model_id == model_id)
        .order_by(KPIDefinition.created_at)
    )
    kpis = result.scalars().all()
    return [KPIResponse.model_validate(k) for k in kpis]


@router.put("/kpis/{kpi_id}", response_model=KPIResponse)
async def update_kpi(
    kpi_id: str,
    body: KPICreate,
    db: AsyncSession = Depends(get_db),
) -> KPIResponse:
    """Update a KPI definition."""
    kpi = await _get_kpi_or_404(kpi_id, db)

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(kpi, field, value)

    await db.commit()
    await db.refresh(kpi)
    logger.info("Updated KPI id=%s", kpi_id)
    return KPIResponse.model_validate(kpi)


@router.delete("/kpis/{kpi_id}", status_code=204)
async def delete_kpi(
    kpi_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a KPI definition."""
    kpi = await _get_kpi_or_404(kpi_id, db)
    await db.delete(kpi)
    await db.commit()
    logger.info("Deleted KPI id=%s", kpi_id)


# ---------------------------------------------------------------------------
# KPI Evaluation
# ---------------------------------------------------------------------------


@router.post("/models/{model_id}/kpis/evaluate", response_model=KPIEvalResponse)
async def evaluate_model_kpis(
    model_id: str,
    body: KPIEvalRequest,
    db: AsyncSession = Depends(get_db),
) -> KPIEvalResponse:
    """Evaluate all (or specified) KPIs for a model against actuals or a scenario.

    KPI dependency graph is resolved and evaluated in topological order via DuckDB.
    """
    result = await db.execute(select(Model).where(Model.id == model_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")

    # Load KPI definitions
    kpi_ids = body.kpi_ids
    if kpi_ids:
        result = await db.execute(
            select(KPIDefinition).where(KPIDefinition.model_id == model_id, KPIDefinition.kpi_id.in_(kpi_ids))
        )
    else:
        result = await db.execute(
            select(KPIDefinition).where(KPIDefinition.model_id == model_id).order_by(KPIDefinition.created_at)
        )
    kpi_records = result.scalars().all()

    if not kpi_records:
        return KPIEvalResponse(kpis=[])

    kpi_id_list = [k.kpi_id for k in kpi_records]
    try:
        results = evaluate_kpis(
            kpi_ids=kpi_id_list,
            model_id=model_id,
            group_by=body.group_by,
            filters=body.filters or {},
            scenario_id=body.scenario_id,
        )
    except Exception as exc:
        logger.exception("KPI evaluation failed for model %s: %s", model_id, exc)
        raise HTTPException(
            status_code=500, detail=f"KPI evaluation failed: {exc}"
        ) from exc

    logger.info("Evaluated %d KPIs for model %s", len(kpi_records), model_id)
    return KPIEvalResponse(kpis=results)
