from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict

logger = logging.getLogger(__name__)


class KPICreate(BaseModel):
    kpi_id: str
    label: str
    kpi_type: str  # base_measure|derived
    expression: dict | str  # dict for base_measure, string for derived
    depends_on: list[str] = []
    format: dict | None = None
    sort_order: int = 0


class KPIResponse(BaseModel):
    id: str
    model_id: str
    kpi_id: str
    label: str
    kpi_type: str
    expression: Any
    depends_on: list[str]
    format: dict | None = None
    is_default: bool
    status: str
    sort_order: int

    model_config = ConfigDict(from_attributes=True)


class KPIEvalRequest(BaseModel):
    kpi_ids: list[str]
    group_by: list[str] | None = None
    filters: dict[str, list[str]] = {}
    scenario_id: str | None = None


class KPIValue(BaseModel):
    kpi_id: str
    label: str
    value: float | None
    format: dict | None = None
    scenario_value: float | None = None
    delta: float | None = None
    delta_pct: float | None = None


class KPIEvalResponse(BaseModel):
    kpis: list[KPIValue]
    grouped: list[dict] | None = None  # when group_by is specified
