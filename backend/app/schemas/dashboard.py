from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class DashboardCreate(BaseModel):
    name: str
    description: str | None = None


class DashboardUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class WidgetCreate(BaseModel):
    name: str
    widget_type: str = "table"
    config: dict[str, Any] = {}
    position: dict[str, Any] = {}


class WidgetUpdate(BaseModel):
    name: str | None = None
    widget_type: str | None = None
    config: dict[str, Any] | None = None
    position: dict[str, Any] | None = None


class WidgetResponse(BaseModel):
    id: str
    dashboard_id: str
    model_id: str
    name: str
    widget_type: str
    config: dict[str, Any]
    position: dict[str, Any]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DashboardResponse(BaseModel):
    id: str
    model_id: str
    name: str
    description: str | None = None
    widgets: list[WidgetResponse] = []
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class LayoutUpdate(BaseModel):
    widgets: list[dict[str, Any]]
