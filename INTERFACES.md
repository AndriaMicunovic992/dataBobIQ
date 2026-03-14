# Interface Contracts

All service-to-service boundaries. Claude Code should implement these exact
signatures. Types reference Pydantic schemas defined in `app/schemas/`.

---

## DuckDB Engine (`app/duckdb_engine.py`)

```python
import duckdb
import threading

_local = threading.local()

def get_duckdb_conn() -> duckdb.DuckDBPyConnection:
    """Return a thread-local DuckDB connection.
    
    Creates on first call per thread. Pre-loads Parquet files as views
    for all active datasets. Connection is read-only for API threads.
    """

def register_dataset(dataset_id: str, parquet_path: str) -> None:
    """Register a Parquet file as a named DuckDB view.
    
    Creates: CREATE OR REPLACE VIEW ds_{dataset_id} AS 
             SELECT * FROM read_parquet('{parquet_path}')
    Also registers dimension views (dim_date, dim_account, etc.)
    Called after materialization completes.
    """

def unregister_dataset(dataset_id: str) -> None:
    """Drop a dataset's DuckDB view."""

def execute_query(sql: str, params: dict | None = None) -> list[dict]:
    """Execute a read-only DuckDB query, return list of row dicts.
    
    All pivot, scenario, and KPI queries go through this.
    Raises DuckDBError on failure.
    """
```

---

## Pivot Engine (`app/services/pivot_engine.py`)

```python
from app.schemas.pivot import PivotRequest, PivotResponse

def build_pivot_sql(
    request: PivotRequest,
    dataset_id: str,
    scenario_ids: list[str] | None = None,
) -> tuple[str, dict]:
    """Translate a PivotRequest into a parameterized DuckDB SQL string.
    
    Handles:
    - GROUP BY for row_dimensions
    - PIVOT for column_dimension (when present)
    - SUM/AVG/COUNT/MIN/MAX for measures
    - WHERE clauses for filters
    - COALESCE joins for scenario overlays
    - GROUP BY ROLLUP when include_totals=True
    - ORDER BY, LIMIT, OFFSET
    
    Returns (sql_string, params_dict).
    """

def execute_pivot(
    request: PivotRequest,
    dataset_id: str,
    scenario_ids: list[str] | None = None,
) -> PivotResponse:
    """Build and execute a pivot query. Returns aggregated results.
    
    Typical response: 10–500 rows regardless of dataset size.
    Target latency: <100ms for 500K-row datasets.
    """

def build_waterfall_sql(
    dataset_id: str,
    scenario_id: str,
    breakdown_field: str,
    value_field: str,
    filters: dict | None = None,
) -> tuple[str, dict]:
    """Build SQL for waterfall/bridge chart data."""

def execute_waterfall(
    dataset_id: str,
    scenario_id: str,
    breakdown_field: str,
    value_field: str,
    filters: dict | None = None,
) -> list[dict]:
    """Execute waterfall query. Returns step list for chart rendering."""
```

---

## Metadata Service (`app/services/metadata_svc.py`)

```python
from app.schemas.datasets import MetadataResponse

async def get_model_metadata(
    model_id: str,
    db: AsyncSession,
) -> MetadataResponse:
    """Return all dimensions, measures, value lists, and scenarios for a model.
    
    This is what the frontend loads on mount instead of the full baseline.
    Includes:
    - All datasets with their columns (name, type, role, cardinality)
    - Dimension values for filter dropdowns (unique values per column)
    - Available measures with stats (min, max, sum)
    - Active scenarios with summary
    - Available KPIs with status
    """
```

---

## Scenario Engine (`app/services/scenario_engine.py`)

```python
from app.schemas.scenarios import ScenarioRule

def apply_rule(
    dataset_id: str,
    scenario_id: str,
    rule: ScenarioRule,
) -> int:
    """Apply a single rule to the baseline and write overrides to Parquet.
    
    1. Query DuckDB for matching rows (filters + period range)
    2. Compute adjusted values (multiplier/offset with distribution)
    3. Write override rows to scenarios/{model_id}/{scenario_id}/overrides.parquet
    
    Returns number of affected rows.
    """

def recompute_scenario(
    dataset_id: str,
    scenario_id: str,
    rules: list[ScenarioRule],
) -> int:
    """Recompute all overrides for a scenario from scratch.
    
    Deletes existing overrides, applies all rules in priority order.
    Used when rules are reordered, modified, or deleted.
    Returns total affected rows.
    """

def build_scenario_merge_sql(
    dataset_id: str,
    scenario_ids: list[str],
    group_by: list[str],
    value_field: str,
    filters: dict | None = None,
) -> tuple[str, dict]:
    """Build SQL that merges baseline with scenario overlays.
    
    Uses COALESCE pattern:
    SELECT ..., 
           SUM(f.amount) as actuals,
           SUM(COALESCE(s.new_value, f.amount)) as scenario
    FROM baseline f
    LEFT JOIN overrides s ON f.row_id = s.row_id
    GROUP BY ...
    """

def compute_variance(
    dataset_id: str,
    scenario_id: str,
    group_by: list[str],
    value_field: str,
    filters: dict | None = None,
) -> dict:
    """Compute actual vs scenario variance by group.
    
    Returns {groups: [{group, actual, scenario, delta, delta_pct}],
             total_actual, total_scenario, total_delta, total_delta_pct}
    """
```

---

## KPI Engine (`app/services/kpi_engine.py`)

```python
from app.schemas.kpis import KPIDefinition, KPIResult

def evaluate_kpis(
    kpi_ids: list[str],
    model_id: str,
    group_by: list[str] | None = None,
    filters: dict | None = None,
    scenario_id: str | None = None,
) -> list[KPIResult]:
    """Evaluate KPIs respecting dependency order.
    
    1. Load KPI definitions from PostgreSQL
    2. Topological sort by depends_on
    3. Evaluate base measures (→ DuckDB SQL)
    4. Evaluate derived measures (→ simpleeval expressions)
    5. Optionally compare with scenario values
    
    Returns evaluated KPI values, optionally grouped.
    """

def compile_base_measure(
    kpi: KPIDefinition,
    group_by: list[str],
    filters: dict,
) -> tuple[str, dict]:
    """Compile a base-measure KPI to DuckDB SQL.
    
    Returns (sql, params) for a grouped aggregation with KPI-level filters.
    """

def resolve_evaluation_order(
    kpi_definitions: dict[str, KPIDefinition],
) -> list[str]:
    """Topological sort of KPI dependency graph.
    
    Uses graphlib.TopologicalSorter. Raises CycleError if circular deps.
    """
```

---

## Ingestion Pipeline (`app/services/ingestion.py`)

```python
async def process_upload(
    model_id: str,
    dataset_id: str,
    file_path: str,
) -> None:
    """Full ingestion pipeline. Runs via FastAPI BackgroundTasks.
    
    Steps:
    1. Parse file (parser.py) — Polars + calamine
    2. Classify fact type (fact_classifier.py)
    3. AI schema mapping (column_mapper.py) — Claude
    4. Store mapping_config on dataset record (status: mapped_pending_review)
    
    Steps 5-7 run after user confirms mapping:
    5. Materialize to Parquet (materializer.py)
    6. Register in DuckDB (duckdb_engine.py)
    7. Post-processing (calendar links, semantic layer, KPI activation)
    
    Note: For Railway MVP, this runs in-process via BackgroundTasks.
    For production/Azure, migrate to ARQ (async Redis queue) for
    proper retry, queue persistence, and worker scaling.
    """

async def confirm_mapping_and_materialize(
    dataset_id: str,
    mapping_config: dict,
) -> None:
    """Called when user confirms the column mapping.
    
    Runs steps 5-7 of the pipeline.
    """
```

---

## Fact Classifier (`app/services/fact_classifier.py`)

```python
from app.fact_types.registry import FactTypeDefinition

def classify_upload(
    columns: list[dict],
    sample_rows: list[dict],
) -> tuple[str, float, dict]:
    """Classify an upload against known fact types.
    
    Returns (fact_type_id, confidence_score, mapping_hints).
    fact_type_id is "financial_transactions" or "custom".
    confidence_score is 0.0–1.0.
    mapping_hints = {raw_column: canonical_column} for matched columns.
    """

def match_fact_type(
    columns: list[dict],
    fact_type: FactTypeDefinition,
) -> tuple[float, dict]:
    """Score how well columns match a fact type definition.
    
    Checks core columns (must match), expected columns (boost score),
    using alias lists for fuzzy matching.
    Returns (score, column_mapping).
    """
```

---

## Column Mapper (`app/services/column_mapper.py`)

```python
async def ai_suggest_mapping(
    columns: list[dict],
    sample_rows: list[dict],
    fact_type_id: str,
    fact_type_def: dict | None,
) -> dict:
    """Ask Claude to propose column → canonical mapping.
    
    For financial_transactions: maps to canonical names (amount, account_key, etc.)
    For custom: classifies as measure/dimension/time/key with display names.
    
    Returns {
        "mappings": [
            {"source": "hauptkonto", "target": "account_key", "confidence": "high"},
            {"source": "betrag", "target": "amount", "confidence": "high"},
        ],
        "sign_convention": "expenses_negative",
        "detected_hierarchy": {...},
    }
    """
```

---

## Materializer (`app/services/materializer.py`)

```python
import polars as pl

def materialize_to_parquet(
    df: pl.DataFrame,
    mapping_config: dict,
    dataset_id: str,
    model_id: str,
    data_dir: str,
) -> str:
    """Transform raw parsed data to canonical Parquet.
    
    1. Rename columns per mapping_config
    2. Cast types (numeric coercion, date normalization)
    3. Generate surrogate keys for dimension lookups
    4. Add data_layer, source_key, row_id columns
    5. Write to {data_dir}/processed/{model_id}/{dataset_id}/data.parquet
    
    Returns the Parquet file path.
    """

def extract_dimensions(
    df: pl.DataFrame,
    mapping_config: dict,
    model_id: str,
    data_dir: str,
) -> dict[str, str]:
    """Extract dimension tables from the data and write as Parquet.
    
    Returns {dim_name: parquet_path} for each extracted dimension.
    """
```

---

## Chat Engine (`app/services/chat_engine.py`)

```python
from typing import AsyncGenerator

async def stream_chat(
    message: str,
    dataset_id: str,
    model_id: str,
    history: list[dict],
    context: str,
    agent_mode: str,  # "data_understanding" | "scenario"
) -> AsyncGenerator[str, None]:
    """Async generator yielding SSE events for one chat turn.
    
    Events:
    - {"type": "text_delta", "text": "...", "agent": "scenario"}
    - {"type": "tool_executing", "tool": "query_data", "input": {...}}
    - {"type": "tool_result", "tool": "query_data", "result": {...}}
    - {"type": "scenario_rules", "rules": [...], "scenario_id": "..."}
    - {"type": "knowledge_saved", "id": "...", "entry_type": "..."}
    - {"type": "done"}
    - {"type": "error", "message": "..."}
    
    Tool execution calls DuckDB via execute_query() — never loads
    full datasets into Python memory.
    """
```

---

## Storage Helpers (`app/services/storage.py`)

```python
import polars as pl

def write_parquet(df: pl.DataFrame, path: str) -> int:
    """Write a Polars DataFrame to Parquet. Returns row count."""

def read_parquet(path: str, columns: list[str] | None = None) -> pl.DataFrame:
    """Read a Parquet file into a Polars DataFrame."""

def ensure_data_dirs(data_dir: str, model_id: str) -> dict[str, str]:
    """Create directory structure for a model's data.
    
    Returns {
        "raw": "{data_dir}/raw/{model_id}",
        "processed": "{data_dir}/processed/{model_id}",
        "dimensions": "{data_dir}/processed/{model_id}/dimensions",
        "scenarios": "{data_dir}/scenarios/{model_id}",
    }
    """

def get_parquet_path(data_dir: str, model_id: str, dataset_id: str) -> str:
    """Return the Parquet path for a dataset."""

def get_dimension_path(data_dir: str, model_id: str, dim_name: str) -> str:
    """Return the Parquet path for a dimension table."""

def get_scenario_path(data_dir: str, model_id: str, scenario_id: str) -> str:
    """Return the Parquet path for scenario overrides."""
```

---

## Fact Type Registry (`app/fact_types/registry.py`)

```python
from dataclasses import dataclass

@dataclass
class ColumnDef:
    name: str
    type: str              # currency, decimal, text, date, boolean
    description: str
    aliases: list[str]
    shared_dim: str | None  # dim_account, dim_date, etc.

@dataclass
class FactTypeDefinition:
    id: str
    grain: str
    core_measures: list[ColumnDef]
    core_dimensions: list[ColumnDef]
    expected_measures: list[ColumnDef]
    expected_dimensions: list[ColumnDef]
    system_columns: list[ColumnDef]
    default_kpis: list[dict]

def load_fact_types() -> dict[str, FactTypeDefinition]:
    """Load all fact type definitions from YAML files in fact_types/.
    
    Returns {fact_type_id: FactTypeDefinition}.
    Currently only 'financial_transactions'.
    """

def get_fact_type(fact_type_id: str) -> FactTypeDefinition | None:
    """Get a specific fact type definition."""
```
