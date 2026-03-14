# Scenario Engine: Delta Overlays

## Current Problem

The current engine copies the entire baseline into memory (Polars DataFrame or JS array), applies rules by mutating values in the copy, and returns the full modified dataset. For 500K rows, this means duplicating ~50MB per scenario, computing mutations row by row, and serializing the entire result to JSON. Multiple active scenarios multiply this cost.

## Delta Overlay Pattern

Instead of copying and mutating, store only what changed. A scenario is a set of **rules** that produce **overrides** — just the rows and fields whose values differ from baseline. At query time, `COALESCE(override, baseline)` merges the delta in milliseconds.

### Data Model

**`scenarios`** (PostgreSQL)
```
id              TEXT PRIMARY KEY
model_id        TEXT FK → models
name            TEXT
description     TEXT
base_config     JSONB       -- {source, base_year, source_scenario_id}
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ
```

**`scenario_rules`** (PostgreSQL)
```
id              TEXT PRIMARY KEY
scenario_id     TEXT FK → scenarios
priority        INTEGER     -- execution order
name            TEXT
rule_type       TEXT        -- "multiplier" | "offset" | "set_value"
target_field    TEXT        -- which measure column to modify
adjustment      JSONB       -- {factor: 1.10} or {offset: -300000} or {value: 0}
filter_expr     JSONB       -- {account_type: ["expense"], cost_center: ["KST 1200"]}
period_from     TEXT        -- "2026-01"
period_to       TEXT        -- "2026-12"
distribution    TEXT        -- "proportional" | "equal"
created_at      TIMESTAMPTZ
```

**`scenario_overrides`** (Parquet in Blob Storage)
```
Path: scenarios/{model_id}/{scenario_id}/overrides.parquet

Columns:
  row_id          BIGINT      -- FK to fact table row
  rule_id         TEXT        -- which rule produced this override
  field_name      TEXT        -- which column was modified
  new_value       DOUBLE      -- the post-adjustment value
  baseline_value  DOUBLE      -- the original value (for audit/variance)
```

### Rule Application Flow

When a user creates or modifies a scenario rule:

1. **Identify affected rows** — DuckDB query with the rule's filters + period range against the baseline Parquet
2. **Compute new values** — apply the adjustment (multiply, offset, set) to the matched rows
3. **Write overrides** — store only (row_id, field, new_value, baseline_value) to the overrides Parquet file
4. **Rules applied in priority order** — if rule 2 depends on rule 1's output, rule 1's overrides are applied first

```python
async def apply_rule(scenario_id: str, rule: ScenarioRule, conn: duckdb.DuckDBPyConnection):
    """Apply a single rule and write overrides to Parquet."""
    
    # Build filter WHERE clause from rule definition
    where = build_filter_sql(rule.filter_expr, rule.period_from, rule.period_to)
    
    if rule.rule_type == "multiplier":
        sql = f"""
            SELECT row_id, 
                   '{rule.target_field}' AS field_name,
                   {rule.target_field} * {rule.adjustment['factor']} AS new_value,
                   {rule.target_field} AS baseline_value,
                   '{rule.id}' AS rule_id
            FROM baseline
            WHERE {where}
        """
    elif rule.rule_type == "offset":
        if rule.distribution == "equal":
            # Count matching periods, split evenly
            sql = f"""
                WITH matched AS (
                    SELECT row_id, {rule.target_field}, fiscal_period,
                           COUNT(DISTINCT fiscal_period) OVER () AS n_periods,
                           COUNT(*) OVER (PARTITION BY fiscal_period) AS rows_in_period
                    FROM baseline WHERE {where}
                )
                SELECT row_id,
                       '{rule.target_field}' AS field_name,
                       {rule.target_field} + ({rule.adjustment['offset']} / n_periods / rows_in_period) AS new_value,
                       {rule.target_field} AS baseline_value,
                       '{rule.id}' AS rule_id
                FROM matched
            """
        else:  # proportional
            sql = f"""
                WITH matched AS (
                    SELECT row_id, {rule.target_field},
                           SUM(ABS({rule.target_field})) OVER () AS total_abs
                    FROM baseline WHERE {where}
                )
                SELECT row_id,
                       '{rule.target_field}' AS field_name,
                       {rule.target_field} + (
                           {rule.adjustment['offset']} * ABS({rule.target_field}) 
                           / NULLIF(total_abs, 0)
                       ) AS new_value,
                       {rule.target_field} AS baseline_value,
                       '{rule.id}' AS rule_id
                FROM matched
            """
    
    # Execute and write to Parquet
    result = conn.execute(sql).fetchdf()  # Returns pandas/polars DataFrame
    # Append to overrides Parquet (or replace if re-computing)
    write_overrides(scenario_id, rule.id, result)
```

### Querying with Overlays

The pivot API merges overlays at query time:

```sql
SELECT 
    a.account_group,
    d.fiscal_period,
    -- Actuals
    SUM(f.net_amount) AS actuals,
    -- Scenario: use override if exists, else baseline
    SUM(COALESCE(s.new_value, f.net_amount)) AS scenario,
    -- Variance
    SUM(COALESCE(s.new_value, f.net_amount)) - SUM(f.net_amount) AS delta
FROM read_parquet('processed/{model_id}/{dataset_id}/data.parquet') f
JOIN dim_account a ON f.account_key = a.account_key  
JOIN dim_date d ON f.date_key = d.date_key
LEFT JOIN read_parquet('scenarios/{model_id}/{scenario_id}/overrides.parquet') s
    ON f.row_id = s.row_id
WHERE d.fiscal_year = '2025'
GROUP BY a.account_group, d.fiscal_period
```

On 500K rows with a 10K-row overlay, this executes in under 50ms.

### Future Period Projection

When scenario rules target periods that don't exist in baseline (e.g., rules for 2026 with only 2025 actuals):

1. **Detect future periods** — compare rule's periodFrom/periodTo against existing periods
2. **Generate template rows** — copy the base year's pattern, shifting period values
3. **Store as projected rows** in a separate Parquet partition with `data_layer = 'projected'`
4. **Apply rules to projected rows** — same overlay mechanism

```python
def generate_projected_periods(conn, dataset_id, base_year, target_periods):
    """Create template rows for future periods from base year data."""
    sql = f"""
        SELECT * EXCLUDE (row_id, date_key, fiscal_period),
               nextval('row_seq') AS row_id,
               target.period AS fiscal_period,
               'projected' AS data_layer
        FROM baseline
        CROSS JOIN (VALUES {','.join(f"('{p}')" for p in target_periods)}) AS target(period)
        WHERE fiscal_period LIKE '{base_year}-%'
          AND RIGHT(fiscal_period, 2) = RIGHT(target.period, 2)
    """
    return conn.execute(sql)
```

### Scenario Chaining

When a scenario's `base_config.source` is another scenario, the engine resolves the chain:

1. Load the source scenario's overrides
2. Apply them to the baseline to get an intermediate result
3. Apply the current scenario's rules on top

Maximum chain depth: 5 levels (same as current architecture). The override Parquet for a chained scenario stores the final computed values, not the intermediate steps — so reading a chained scenario is the same cost as a simple one.

### Waterfall Decomposition

Each override row carries a `rule_id`. This enables per-rule variance decomposition:

```sql
SELECT 
    r.name AS rule_name,
    SUM(s.new_value - s.baseline_value) AS rule_impact
FROM scenario_overrides s
JOIN scenario_rules r ON s.rule_id = r.id
WHERE s.scenario_id = 'sc_001'
GROUP BY r.name
ORDER BY ABS(rule_impact) DESC
```

This powers the waterfall chart showing "Revenue +10% contributed +120K, Cost Reduction contributed -50K."

### Multi-Scenario Comparison

Comparing three scenarios against actuals is a single query with multiple LEFT JOINs:

```sql
SELECT 
    a.account_group,
    SUM(f.net_amount) AS actuals,
    SUM(COALESCE(s1.new_value, f.net_amount)) AS scenario_1,
    SUM(COALESCE(s2.new_value, f.net_amount)) AS scenario_2,
    SUM(COALESCE(s3.new_value, f.net_amount)) AS scenario_3
FROM baseline f
JOIN dim_account a ON f.account_key = a.account_key
LEFT JOIN overrides_sc1 s1 ON f.row_id = s1.row_id
LEFT JOIN overrides_sc2 s2 ON f.row_id = s2.row_id
LEFT JOIN overrides_sc3 s3 ON f.row_id = s3.row_id
GROUP BY a.account_group
```

All computed server-side in under 100ms. The frontend receives a compact comparison table ready to render.
