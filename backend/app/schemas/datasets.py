from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, field_validator

logger = logging.getLogger(__name__)


class DatasetColumnResponse(BaseModel):
    id: str
    dataset_id: str
    source_name: str
    canonical_name: str | None = None
    display_name: str
    data_type: str
    column_role: str
    column_tier: str | None = None
    shared_dim: str | None = None
    unique_count: int | None = None
    sample_values: list[Any] | None = None

    model_config = ConfigDict(from_attributes=True)


class DatasetResponse(BaseModel):
    id: str
    model_id: str | None = None
    name: str
    source_filename: str | None = None
    fact_type: str
    row_count: int
    status: str
    data_layer: str
    ai_analyzed: bool = False
    mapping_config: dict[str, Any] | None = None
    created_at: datetime
    columns: list[DatasetColumnResponse] = []

    model_config = ConfigDict(from_attributes=True)

    @field_validator("columns", mode="before")
    @classmethod
    def _coerce_columns(cls, v):
        if v is None:
            return []
        # SQLAlchemy InstrumentedList may not be recognised as a plain list
        if not isinstance(v, list):
            try:
                return list(v)
            except TypeError:
                return [v]
        return v


class DatasetColumnUpdate(BaseModel):
    """Partial update for a dataset column."""
    column_role: str | None = None
    canonical_name: str | None = None
    display_name: str | None = None
    data_type: str | None = None

    model_config = ConfigDict(from_attributes=True)


class DimensionInfo(BaseModel):
    field: str
    label: str
    source: str | None = None  # dim_account, dim_date, etc.
    cardinality: int
    values: list[str] = []  # unique values for filter dropdowns


class MeasureInfo(BaseModel):
    field: str
    label: str
    type: str  # currency, decimal, integer
    stats: dict | None = None  # {min, max, sum}


class DatasetMetadata(BaseModel):
    id: str
    name: str
    fact_type: str
    row_count: int
    measures: list[MeasureInfo]
    dimensions: list[DimensionInfo]


class MetadataResponse(BaseModel):
    model_id: str
    datasets: list[DatasetMetadata]
    scenarios: list[dict] = []  # [{id, name, rule_count}]
    kpis: list[dict] = []  # [{kpi_id, label, status}]
