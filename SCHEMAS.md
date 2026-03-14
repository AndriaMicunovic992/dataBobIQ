# Pydantic Schema Reference for Claude Code
# Copy these into the appropriate app/schemas/*.py files

## app/schemas/pivot.py

```python
from __future__ import annotations
from typing import Any, Literal
from pydantic import BaseModel, Field

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
    scenario_ids: list[str] = []        # empty = actuals only
    sort_by: dict | None = None         # {"field": "...", "direction": "asc|desc"}
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
```

## app/schemas/datasets.py

```python
from __future__ import annotations
from datetime import datetime
from typing import Any
from pydantic import BaseModel, ConfigDict

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
    created_at: datetime
    columns: list[DatasetColumnResponse] = []
    model_config = ConfigDict(from_attributes=True)

class DimensionInfo(BaseModel):
    field: str
    label: str
    source: str | None = None    # dim_account, dim_date, etc.
    cardinality: int
    values: list[str] = []       # unique values for filter dropdowns

class MeasureInfo(BaseModel):
    field: str
    label: str
    type: str                    # currency, decimal, integer
    stats: dict | None = None    # {min, max, sum}

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
    scenarios: list[dict] = []   # [{id, name, rule_count}]
    kpis: list[dict] = []        # [{kpi_id, label, status}]
```

## app/schemas/scenarios.py

```python
from __future__ import annotations
from datetime import datetime
from typing import Any
from pydantic import BaseModel, ConfigDict

class ScenarioRuleCreate(BaseModel):
    name: str
    rule_type: str              # multiplier|offset|set_value
    target_field: str = "amount"
    adjustment: dict            # {factor: 1.10} or {offset: -300000}
    filter_expr: dict | None = None
    period_from: str | None = None
    period_to: str | None = None
    distribution: str = "proportional"

class ScenarioCreate(BaseModel):
    name: str
    dataset_id: str
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
    dataset_id: str
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
    name: str
    value: float
    running_total: float
    is_total: bool
    delta_pct: float | None = None
```

## app/schemas/kpis.py

```python
from __future__ import annotations
from datetime import datetime
from typing import Any
from pydantic import BaseModel, ConfigDict

class KPICreate(BaseModel):
    kpi_id: str
    label: str
    kpi_type: str           # base_measure|derived
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
```
