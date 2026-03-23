from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.metadata import Dashboard, DashboardWidget, Model
from app.schemas.dashboard import (
    DashboardCreate,
    DashboardResponse,
    DashboardUpdate,
    LayoutUpdate,
    WidgetCreate,
    WidgetResponse,
    WidgetUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["dashboard"])


# ── Dashboard CRUD ──────────────────────────────────────────────────

@router.post("/models/{model_id}/dashboards", response_model=DashboardResponse, status_code=201)
async def create_dashboard(
    model_id: str, body: DashboardCreate, db: AsyncSession = Depends(get_db),
) -> DashboardResponse:
    result = await db.execute(select(Model).where(Model.id == model_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Model not found")
    dash = Dashboard(model_id=model_id, **body.model_dump())
    db.add(dash)
    await db.commit()
    result = await db.execute(
        select(Dashboard).options(selectinload(Dashboard.widgets)).where(Dashboard.id == dash.id)
    )
    dash = result.scalar_one()
    return DashboardResponse.model_validate(dash)


@router.get("/models/{model_id}/dashboards", response_model=list[DashboardResponse])
async def list_dashboards(
    model_id: str, db: AsyncSession = Depends(get_db),
) -> list[DashboardResponse]:
    result = await db.execute(
        select(Dashboard)
        .options(selectinload(Dashboard.widgets))
        .where(Dashboard.model_id == model_id)
        .order_by(Dashboard.created_at.asc())
    )
    return [DashboardResponse.model_validate(d) for d in result.scalars().unique().all()]


@router.get("/dashboards/{dashboard_id}", response_model=DashboardResponse)
async def get_dashboard(
    dashboard_id: str, db: AsyncSession = Depends(get_db),
) -> DashboardResponse:
    result = await db.execute(
        select(Dashboard).options(selectinload(Dashboard.widgets)).where(Dashboard.id == dashboard_id)
    )
    dash = result.scalar_one_or_none()
    if dash is None:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    return DashboardResponse.model_validate(dash)


@router.put("/dashboards/{dashboard_id}", response_model=DashboardResponse)
async def update_dashboard(
    dashboard_id: str, body: DashboardUpdate, db: AsyncSession = Depends(get_db),
) -> DashboardResponse:
    result = await db.execute(
        select(Dashboard).options(selectinload(Dashboard.widgets)).where(Dashboard.id == dashboard_id)
    )
    dash = result.scalar_one_or_none()
    if dash is None:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(dash, field, value)
    await db.commit()
    await db.refresh(dash)
    return DashboardResponse.model_validate(dash)


@router.delete("/dashboards/{dashboard_id}", status_code=204)
async def delete_dashboard(
    dashboard_id: str, db: AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))
    dash = result.scalar_one_or_none()
    if dash is None:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    await db.delete(dash)
    await db.commit()


# ── Widget CRUD ─────────────────────────────────────────────────────

@router.post("/dashboards/{dashboard_id}/widgets", response_model=WidgetResponse, status_code=201)
async def create_widget(
    dashboard_id: str, body: WidgetCreate, db: AsyncSession = Depends(get_db),
) -> WidgetResponse:
    result = await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))
    dash = result.scalar_one_or_none()
    if dash is None:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    widget = DashboardWidget(dashboard_id=dashboard_id, model_id=dash.model_id, **body.model_dump())
    db.add(widget)
    await db.commit()
    await db.refresh(widget)
    return WidgetResponse.model_validate(widget)


@router.put("/dashboard/widgets/{widget_id}", response_model=WidgetResponse)
async def update_widget(
    widget_id: str, body: WidgetUpdate, db: AsyncSession = Depends(get_db),
) -> WidgetResponse:
    result = await db.execute(select(DashboardWidget).where(DashboardWidget.id == widget_id))
    widget = result.scalar_one_or_none()
    if widget is None:
        raise HTTPException(status_code=404, detail="Widget not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(widget, field, value)
    await db.commit()
    await db.refresh(widget)
    return WidgetResponse.model_validate(widget)


@router.delete("/dashboard/widgets/{widget_id}", status_code=204)
async def delete_widget(
    widget_id: str, db: AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(select(DashboardWidget).where(DashboardWidget.id == widget_id))
    widget = result.scalar_one_or_none()
    if widget is None:
        raise HTTPException(status_code=404, detail="Widget not found")
    await db.delete(widget)
    await db.commit()


@router.put("/dashboards/{dashboard_id}/layout")
async def update_layout(
    dashboard_id: str, body: LayoutUpdate, db: AsyncSession = Depends(get_db),
) -> dict:
    for item in body.widgets:
        wid = item.get("id")
        pos = item.get("position")
        if not wid or not pos:
            continue
        result = await db.execute(
            select(DashboardWidget).where(
                DashboardWidget.id == wid, DashboardWidget.dashboard_id == dashboard_id
            )
        )
        widget = result.scalar_one_or_none()
        if widget:
            widget.position = pos
    await db.commit()
    return {"status": "ok"}
