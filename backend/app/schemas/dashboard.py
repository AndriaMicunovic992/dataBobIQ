from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class WidgetCreate(BaseModel):
    name: str
    widget_type: str = "table"  # table|card
    config: dict[str, Any] = {}
    position: dict[str, Any] = {}  # {x, y, w, h}


class WidgetUpdate(BaseModel):
    name: str | None = None
    widget_type: str | None = None
    config: dict[str, Any] | None = None
    position: dict[str, Any] | None = None


class WidgetResponse(BaseModel):
    id: str
    model_id: str
    name: str
    widget_type: str
    config: dict[str, Any]
    position: dict[str, Any]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class LayoutUpdate(BaseModel):
    """Batch-update widget positions."""
    widgets: list[dict[str, Any]]  # [{id, position: {x, y, w, h}}]
