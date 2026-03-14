# KPI Engine: Declarative Metrics with Dependency Graphs

## Design Philosophy

KPI definitions are **configuration, not code**. They're stored as YAML/JSON in PostgreSQL, evaluated via a dependency graph, and compiled to DuckDB SQL at query time. This makes them AI-readable (Claude can suggest new KPIs), user-modifiable through the UI, and version-controllable.

## KPI Definition Schema

```yaml
# Stored in PostgreSQL kpi_definitions table as JSONB

revenue:
  label: "Revenue"
  type: "base_measure"
  expression:
    aggregation: "sum"
    field: "net_amount"
    filter:
      account_type: ["revenue"]
  format: { type: "currency", decimals: 0 }

cogs:
  label: "COGS"
  type: "base_measure"
  expression:
    aggregation: "sum"
    field: "net_amount"
    filter:
      p_and_l_line: ["COGS"]
  format: { type: "currency", decimals: 0 }

gross_profit:
  label: "Gross Profit"
  type: "derived"
  expression: "revenue - cogs"
  depends_on: ["revenue", "cogs"]
  format: { type: "currency", decimals: 0 }

gross_margin:
  label: "Gross Margin %"
  type: "derived"
  expression: "gross_profit / abs(revenue) * 100"
  depends_on: ["gross_profit", "revenue"]
  format: { type: "percentage", decimals: 1 }

opex:
  label: "Operating Expenses"
  type: "base_measure"
  expression:
    aggregation: "sum"
    field: "net_amount"
    filter:
      p_and_l_line: ["Operating Expenses"]
  format: { type: "currency", decimals: 0 }

ebitda:
  label: "EBITDA"
  type: "derived"
  expression: "gross_profit - opex"
  depends_on: ["gross_profit", "opex"]
  format: { type: "currency", decimals: 0 }

ebitda_margin:
  label: "EBITDA Margin %"
  type: "derived"
  expression: "ebitda / abs(revenue) * 100"
  depends_on: ["ebitda", "revenue"]
  format: { type: "percentage", decimals: 1 }
```

## Dependency Graph

KPIs form a directed acyclic graph (DAG). Python's built-in `graphlib.TopologicalSorter` determines evaluation order:

```
revenue ──┬──→ gross_profit ──┬──→ ebitda ──→ ebitda_margin
cogs ─────┘        │          │
                   ↓          │
              gross_margin    opex ──┘
```

Evaluation steps:
1. Topological sort: `[revenue, cogs, opex, gross_profit, gross_margin, ebitda, ebitda_margin]`
2. Evaluate base measures first (compile to SQL, execute against DuckDB)
3. Evaluate derived measures in order (simple arithmetic on already-computed values)

For a 20-KPI tree, the base measure SQL queries take 10–50ms each in DuckDB. Derived measure arithmetic is microseconds. Total KPI evaluation: under 200ms for a full P&L.

## Evaluation Engine

```python
from graphlib import TopologicalSorter
from simpleeval import simple_eval

def evaluate_kpis(
    kpi_definitions: dict,
    conn: duckdb.DuckDBPyConnection,
    group_by: list[str],
    filters: dict,
) -> dict[str, list]:
    """Evaluate all KPIs respecting dependency order.
    
    Returns {kpi_id: [values_per_group_row]}.
    """
    # Build dependency graph
    graph = {}
    for kpi_id, defn in kpi_definitions.items():
        graph[kpi_id] = set(defn.get("depends_on", []))
    
    # Topological sort
    sorter = TopologicalSorter(graph)
    eval_order = list(sorter.static_order())
    
    # Evaluate in order
    results = {}
    for kpi_id in eval_order:
        defn = kpi_definitions[kpi_id]
        
        if defn["type"] == "base_measure":
            # Compile to SQL and execute
            sql = compile_base_measure(defn, group_by, filters)
            results[kpi_id] = conn.execute(sql).fetchall()
            
        elif defn["type"] == "derived":
            # Evaluate expression using already-computed values
            results[kpi_id] = evaluate_derived(
                defn["expression"], 
                results, 
                defn["depends_on"]
            )
    
    return results


def compile_base_measure(defn: dict, group_by: list[str], filters: dict) -> str:
    """Compile a base measure KPI to DuckDB SQL."""
    expr = defn["expression"]
    agg = expr["aggregation"]  # sum, avg, count, min, max
    field = expr["field"]
    kpi_filter = expr.get("filter", {})
    
    # Merge KPI-level filters with user-level filters
    all_filters = {**filters, **kpi_filter}
    where_clause = build_where(all_filters)
    group_clause = ", ".join(group_by) if group_by else "1"
    
    return f"""
        SELECT {', '.join(group_by + [f'{agg}({field}) AS value'])}
        FROM financial_transactions f
        JOIN dim_account a ON f.account_key = a.account_key
        JOIN dim_date d ON f.date_key = d.date_key
        LEFT JOIN dim_cost_center cc ON f.cost_center_key = cc.cost_center_key
        WHERE {where_clause}
        GROUP BY {group_clause}
    """


def evaluate_derived(expression: str, results: dict, deps: list) -> list:
    """Evaluate a derived expression like 'revenue - cogs' using simpleeval."""
    # Build variables dict from computed results
    # Assuming all results are aligned by the same group_by keys
    row_count = len(next(iter(results.values()))) if results else 0
    
    output = []
    for i in range(row_count):
        variables = {}
        for dep in deps:
            variables[dep] = results[dep][i][-1]  # last column is 'value'
        
        result = simple_eval(expression, names=variables, functions={"abs": abs})
        output.append(result)
    
    return output
```

## Pre-Built KPI Sets

The `financial_transactions` fact type ships with a default P&L KPI set:

| KPI | Type | Expression/Filter |
|-----|------|-------------------|
| Revenue | Base | `SUM(net_amount) WHERE account_type = 'revenue'` |
| COGS | Base | `SUM(net_amount) WHERE p_and_l_line = 'COGS'` |
| Gross Profit | Derived | `revenue - cogs` |
| Gross Margin % | Derived | `gross_profit / abs(revenue) * 100` |
| Personnel Costs | Base | `SUM(net_amount) WHERE account_group = 'Personnel Costs'` |
| Operating Expenses | Base | `SUM(net_amount) WHERE p_and_l_line = 'Operating Expenses'` |
| EBITDA | Derived | `gross_profit - opex` |
| EBITDA Margin % | Derived | `ebitda / abs(revenue) * 100` |
| Net Income | Base | `SUM(net_amount)` (all accounts) |

These activate automatically when `dim_account` is populated with P&L hierarchy data. If the chart of accounts doesn't include `p_and_l_line` or `account_type` classifications, the KPIs remain inactive until the user (or AI) defines the mapping.

## KPI API Endpoints

### `GET /api/v1/kpis/{model_id}`
Returns all defined KPIs with their current status (active/inactive based on available dimensions).

### `POST /api/v1/kpis/{model_id}/evaluate`
Evaluate KPIs with optional grouping and filters:

```json
{
  "kpi_ids": ["revenue", "gross_profit", "ebitda_margin"],
  "group_by": ["fiscal_period"],
  "filters": { "fiscal_year": ["2025"] },
  "scenario_id": "sc_001"
}
```

Returns:
```json
{
  "columns": ["fiscal_period", "revenue", "gross_profit", "ebitda_margin"],
  "rows": [
    ["2025-01", 450000, 180000, 28.5],
    ["2025-02", 520000, 215000, 31.2]
  ],
  "scenario_comparison": {
    "columns": ["fiscal_period", "revenue", "gross_profit", "ebitda_margin"],
    "rows": [
      ["2025-01", 495000, 198000, 30.1],
      ["2025-02", 572000, 236500, 33.4]
    ]
  }
}
```

### `POST /api/v1/kpis/{model_id}/define`
Create or update a KPI definition. The AI agent also calls this through tool-use.

## Reactivity

When upstream data changes (new upload, scenario modification, dimension update), the dependency graph identifies affected KPIs:

1. New financial data uploaded → all base measures potentially affected → recompute on next query
2. Scenario rule modified → only scenario-comparison values change → overlay recomputed
3. `dim_account` hierarchy updated → KPIs with account-based filters may change

For the MVP, recomputation happens on-demand (at query time). DuckDB is fast enough that re-evaluating a full KPI tree on every request is viable up to ~1M rows. Caching with targeted invalidation can be added later if needed.
