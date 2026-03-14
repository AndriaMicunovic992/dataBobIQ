from __future__ import annotations

import logging
from typing import Any, Literal

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class MeasureDef(BaseModel):
    field: str
    aggregation: Literal["sum", "avg", "count", "min", "max"] = "sum"
    label: str | None = None  # display name; defaults to "{field}_{aggregation}"


class PivotRequest(BaseModel):
    model_id: str
    dataset_id: str
    row_dimensions: list[str] = []
    column_dimension: str | None = None
    measures: list[MeasureDef] = [MeasureDef(field="amount", aggregation="sum")]
    filters: dict[str, list[str]] = {}  # column_name → list of allowed values
    scenario_ids: list[str] = []  # empty = actuals only
    sort_by: dict | None = None  # {"field": "...", "direction": "asc|desc"}
    include_totals: bool = False
    limit: int = Field(default=500, le=5000)
    offset: int = 0


class ColumnInfo(BaseModel):
    field: str
    type: Literal["dimension", "measure", "scenario", "variance"]


class PivotResponse(BaseModel):
    columns: list[ColumnInfo]
    rows: list[list[Any]]
    totals: list[Any] | None = None
    row_count: int
    total_row_count: int
    query_ms: int
