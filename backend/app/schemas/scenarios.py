from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict

logger = logging.getLogger(__name__)


class ScenarioRuleCreate(BaseModel):
    name: str
    rule_type: str  # multiplier|offset|set_value
    target_field: str = "amount"
    dataset_id: str | None = None  # target dataset; auto-resolved when omitted
    adjustment: dict  # {factor: 1.10} or {offset: -300000}
    filter_expr: dict | None = None
    period_from: str | None = None
    period_to: str | None = None
    distribution: str = "proportional"


class ScenarioCreate(BaseModel):
    name: str
    dataset_id: str | None = None  # optional — scenarios are model-level
    description: str | None = None
    base_config: dict | None = None  # {source, base_year}
    color: str | None = None
    rules: list[ScenarioRuleCreate] = []


class ScenarioUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    base_config: dict | None = None
    color: str | None = None


class ScenarioRuleResponse(BaseModel):
    id: str
    scenario_id: str
    dataset_id: str | None = None
    priority: int
    name: str
    rule_type: str
    target_field: str
    adjustment: dict
    filter_expr: dict | None
    period_from: str | None
    period_to: str | None
    distribution: str
    affected_rows: int | None

    model_config = ConfigDict(from_attributes=True)


class ScenarioResponse(BaseModel):
    id: str
    model_id: str | None = None
    dataset_id: str | None = None
    name: str
    description: str | None = None
    base_config: dict | None = None
    color: str | None = None
    rules: list[ScenarioRuleResponse] = []
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class VarianceGroup(BaseModel):
    group: dict[str, Any]
    actual: float
    scenario: float
    delta: float
    delta_pct: float | None


class VarianceResponse(BaseModel):
    groups: list[VarianceGroup]
    total_actual: float
    total_scenario: float
    total_delta: float
    total_delta_pct: float | None


class WaterfallStep(BaseModel):
    label: str
    name: str
    value: float
    running_total: float
    type: str  # start|delta|end
    is_total: bool
    delta_pct: float | None = None
