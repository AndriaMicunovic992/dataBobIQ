from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.metadata import DashboardWidget, Model
from app.schemas.dashboard import LayoutUpdate, WidgetCreate, WidgetResponse, WidgetUpdate

logger = logging.getLogger(__name__)

router = APIRouter(tags=["dashboard"])


@router.post(
    "/models/{model_id}/dashboard/widgets",
    response_model=WidgetResponse,
    status_code=201,
)
async def create_widget(
    model_id: str,
    body: WidgetCreate,
    db: AsyncSession = Depends(get_db),
) -> WidgetResponse:
    result = await db.execute(select(Model).where(Model.id == model_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Model not found")

    widget = DashboardWidget(model_id=model_id, **body.model_dump())
    db.add(widget)
    await db.commit()
    await db.refresh(widget)
    return WidgetResponse.model_validate(widget)


@router.get("/models/{model_id}/dashboard/widgets", response_model=list[WidgetResponse])
async def list_widgets(
    model_id: str,
    db: AsyncSession = Depends(get_db),
) -> list[WidgetResponse]:
    result = await db.execute(
        select(DashboardWidget)
        .where(DashboardWidget.model_id == model_id)
        .order_by(DashboardWidget.created_at.asc())
    )
    return [WidgetResponse.model_validate(w) for w in result.scalars().all()]


@router.put("/dashboard/widgets/{widget_id}", response_model=WidgetResponse)
async def update_widget(
    widget_id: str,
    body: WidgetUpdate,
    db: AsyncSession = Depends(get_db),
) -> WidgetResponse:
    result = await db.execute(
        select(DashboardWidget).where(DashboardWidget.id == widget_id)
    )
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
    widget_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(
        select(DashboardWidget).where(DashboardWidget.id == widget_id)
    )
    widget = result.scalar_one_or_none()
    if widget is None:
        raise HTTPException(status_code=404, detail="Widget not found")
    await db.delete(widget)
    await db.commit()


@router.put("/models/{model_id}/dashboard/layout")
async def update_layout(
    model_id: str,
    body: LayoutUpdate,
    db: AsyncSession = Depends(get_db),
) -> dict:
    for item in body.widgets:
        wid = item.get("id")
        pos = item.get("position")
        if not wid or not pos:
            continue
        result = await db.execute(
            select(DashboardWidget).where(
                DashboardWidget.id == wid, DashboardWidget.model_id == model_id
            )
        )
        widget = result.scalar_one_or_none()
        if widget:
            widget.position = pos
    await db.commit()
    return {"status": "ok"}
