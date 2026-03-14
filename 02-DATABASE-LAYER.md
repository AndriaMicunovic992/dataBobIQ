# Database Layer: PostgreSQL + DuckDB Hybrid

## Why Two Engines

PostgreSQL is excellent for transactional metadata — user records, dataset registries, scenario definitions, KPI configs. It's terrible at scanning 500K rows to compute a grouped aggregation with filters. DuckDB is purpose-built for exactly that: columnar storage, vectorized execution, and sub-100ms grouped aggregations on datasets up to millions of rows. Running DuckDB **embedded** inside the FastAPI process eliminates network hops and connection pooling — it's a library call, not a service call.

## PostgreSQL: Metadata Store

PostgreSQL (Azure Flexible Server, Burstable B1ms) stores everything that is transactional, relational, or small:

- **models** — workspace containers
- **datasets** — upload registry (name, source, status, fact_type, mapping_config)
- **dataset_columns** — column catalog with canonical mappings
- **dimension_registries** — shared dimension table definitions
- **scenarios** — scenario metadata + rule definitions (JSON)
- **scenario_overrides** — materialized delta values (row_id, field, new_value)
- **kpi_definitions** — YAML/JSON KPI configs with dependency refs
- **knowledge_entries** — AI-learned business context
- **semantic_layer** — column descriptions, synonyms, value labels
- **users, sessions, audit_log** — standard app tables

No analytical data lives in PostgreSQL. The `ds_*` dynamic table pattern is eliminated entirely.

## DuckDB: Analytical Engine

DuckDB runs as an embedded library inside each FastAPI worker process. It reads Parquet files from Azure Blob Storage for all analytical operations:

- Pivot queries (GROUP BY + PIVOT with filters)
- Scenario computation (baseline + delta overlay merge)
- Variance analysis (actual vs scenario vs budget)
- KPI base measure evaluation (filtered aggregations)
- AI tool execution (`query_data`, `list_dimension_values`)

### Concurrency Model

DuckDB supports multiple concurrent readers within a single process via MVCC. For FastAPI's async workers:

```python
import duckdb
import threading

_local = threading.local()

def get_duckdb_conn() -> duckdb.DuckDBPyConnection:
    """Thread-local DuckDB connection for concurrent reads."""
    if not hasattr(_local, "conn"):
        _local.conn = duckdb.connect(":memory:")
        _local.conn.execute("INSTALL azure; LOAD azure;")
        _local.conn.execute("INSTALL httpfs; LOAD httpfs;")
        # Configure Azure credentials
        _local.conn.execute(f"""
            SET azure_storage_connection_string = '{settings.AZURE_STORAGE_CONN_STR}';
        """)
    return _local.conn
```

Write operations (data loading during ingestion) happen in the background worker process, which has its own DuckDB instance. No write contention with the API readers.

### Reading Parquet from Blob Storage

DuckDB's Azure extension reads Parquet directly from Blob Storage with zero intermediate copies:

```sql
SELECT department, fiscal_period, SUM(net_amount) as total
FROM read_parquet('az://processed/{tenant_id}/{dataset_id}/data.parquet')
WHERE account_type = 'expense'
GROUP BY department, fiscal_period
ORDER BY fiscal_period;
```

For frequently queried datasets, the worker pre-registers them as DuckDB views during ingestion, so queries use table names instead of file paths.

## Star Schema Design

### Canonical Fact Type: `financial_transactions`

The single known fact type for the MVP. Grain: one monetary posting to an account in a period.

**Core columns (required for type match):**
- `amount` — net monetary value (currency)
- `account_key` — FK to dim_account
- `date_key` — FK to dim_date

**Expected columns (mapped when present, NULL when absent):**
- `debit_amount`, `credit_amount` — split amounts
- `cost_center_key` — FK to dim_cost_center
- `entity_key` — FK to dim_entity
- `document_number` — posting reference
- `posting_text` — free text description
- `data_layer` — "actuals", "budget", "forecast", or scenario ID

**Extension columns:** any additional columns from the upload, stored as-is.

### Shared Dimensions

| Dimension | Key Columns | Purpose |
|-----------|-------------|---------|
| `dim_date` | date_key, fiscal_period, fiscal_year, month, quarter | Calendar hierarchy, seeded 2020–2030 |
| `dim_account` | account_key, account_code, account_name, account_type, account_group, p_and_l_line | Chart of accounts with P&L hierarchy |
| `dim_cost_center` | cost_center_key, cc_code, cc_name, department | Organizational grouping |
| `dim_entity` | entity_key, entity_code, entity_name | Legal entity / company code |
| `dim_source` | source_key, upload_id, filename, upload_date | Data lineage tracking |

Dimensions are stored as small Parquet files alongside the fact data. `dim_date` is seeded at deploy time. `dim_account` is populated from chart-of-accounts uploads. Other dimensions are built from the data during ingestion.

### Custom Fact Types

Non-financial uploads (Tempo, invoices, headcount) are stored as custom types:
- No canonical schema — columns classified as measure/dimension/time/key by AI
- Stored as Parquet with full column metadata in PostgreSQL
- Fully queryable through the same pivot API
- Cross-referencing with financials requires explicit relationship definitions (bridge tables or shared dimension mappings)

## Data Layer Column: Unifying Actuals, Budget, and Scenarios

The `data_layer` column on `financial_transactions` distinguishes data sources:

- `actuals` — real GL postings from ERP exports
- `budget` — budget/plan uploads tagged at ingestion
- `forecast` — rolling forecast data
- `scenario:{id}` — materialized scenario output

This means budget-vs-actuals and scenario comparisons are filter operations, not separate table joins:

```sql
SELECT account_group, fiscal_period,
       SUM(amount) FILTER (WHERE data_layer = 'actuals') AS actuals,
       SUM(amount) FILTER (WHERE data_layer = 'budget') AS budget,
       SUM(amount) FILTER (WHERE data_layer = 'scenario:abc123') AS scenario
FROM financial_transactions f
JOIN dim_account a ON f.account_key = a.account_key
GROUP BY account_group, fiscal_period
```
