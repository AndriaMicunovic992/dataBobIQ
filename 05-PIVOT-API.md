# Server-Side Pivot API

## Why Server-Side

The current architecture loads the entire baseline (500K rows × 30+ columns as JSON) into the browser, then computes pivots, filters, and scenario comparisons in JavaScript. This breaks at scale: a 500K-row baseline serializes to 50–100MB of JSON, takes 3–10 seconds to transfer, and consumes 200–500MB of browser memory. The pivot computation itself adds another second or two on every field change.

Moving aggregation to DuckDB on the server reduces the response payload from 50MB to typically 2–20KB (10–500 aggregated rows), cuts response time to under 100ms, and eliminates browser memory pressure entirely.

## API Design

A single REST endpoint handles all analytical queries. No GraphQL, no Cube.js — both add complexity without proportional benefit at MVP scale.

### `POST /api/v1/pivot`

**Request body:**

```json
{
  "model_id": "abc123",
  "dataset_id": "ds_001",
  "row_dimensions": ["account_group", "fiscal_period"],
  "column_dimension": "entity_name",
  "measures": [
    { "field": "net_amount", "aggregation": "sum", "label": "Total" },
    { "field": "net_amount", "aggregation": "count", "label": "Postings" }
  ],
  "filters": {
    "fiscal_year": ["2025"],
    "account_type": ["expense"],
    "cost_center": ["KST 1200", "KST 1300"]
  },
  "scenario_ids": ["sc_001", "sc_002"],
  "sort_by": { "field": "Total", "direction": "desc" },
  "include_totals": true,
  "limit": 200,
  "offset": 0
}
```

**Response:**

```json
{
  "columns": [
    { "field": "account_group", "type": "dimension" },
    { "field": "fiscal_period", "type": "dimension" },
    { "field": "Total|Company A", "type": "measure" },
    { "field": "Total|Company B", "type": "measure" },
    { "field": "Total|_total", "type": "measure" },
    { "field": "sc_001|Total|Company A", "type": "scenario" },
    { "field": "sc_001|Total|Company B", "type": "scenario" },
    { "field": "sc_001|delta|Company A", "type": "variance" }
  ],
  "rows": [
    ["Personnel Costs", "2025-01", -45000, -32000, -77000, -49500, -35200, -4500],
    ["Material Costs", "2025-01", -28000, -15000, -43000, -28000, -15000, 0]
  ],
  "totals": [-1200000, -800000, -2000000, -1320000, -880000, -120000],
  "row_count": 48,
  "total_row_count": 48,
  "query_ms": 23
}
```

### `GET /api/v1/metadata/{model_id}`

Returns available dimensions, measures, and their value sets — everything the frontend needs to populate field selectors and filter dropdowns without loading any raw data.

```json
{
  "fact_types": [
    {
      "id": "ds_001",
      "name": "GL Entries 2024-2025",
      "fact_type": "financial_transactions",
      "row_count": 487000,
      "measures": [
        { "field": "net_amount", "type": "currency", "label": "Amount" },
        { "field": "debit_amount", "type": "currency", "label": "Debit" }
      ],
      "dimensions": [
        { 
          "field": "account_group", 
          "label": "Account Group",
          "source": "dim_account",
          "cardinality": 12,
          "values": ["Personnel Costs", "Material Costs", "Revenue", "..."]
        },
        {
          "field": "fiscal_period",
          "label": "Period",
          "source": "dim_date",
          "cardinality": 24,
          "values": ["2024-01", "2024-02", "...", "2025-12"]
        }
      ]
    }
  ],
  "scenarios": [
    { "id": "sc_001", "name": "Revenue +10%", "rule_count": 2 },
    { "id": "sc_002", "name": "Cost Reduction Plan", "rule_count": 5 }
  ]
}
```

### `POST /api/v1/pivot/waterfall`

Dedicated endpoint for waterfall/bridge chart data. Takes the same filter/scenario config but returns contribution-by-dimension breakdown:

```json
{
  "steps": [
    { "name": "Actuals", "value": -2000000, "running_total": -2000000, "is_total": true },
    { "name": "Personnel Costs", "value": -120000, "running_total": -2120000, "delta_pct": 6.0 },
    { "name": "Material Costs", "value": 50000, "running_total": -2070000, "delta_pct": -2.5 },
    { "name": "Scenario", "value": -2070000, "running_total": -2070000, "is_total": true }
  ]
}
```

## DuckDB Query Generation

The pivot endpoint translates the request into DuckDB SQL. The query builder handles:

### Basic Pivot
```sql
SELECT account_group, fiscal_period,
       SUM(net_amount) AS "Total"
FROM financial_transactions f
JOIN dim_account a ON f.account_key = a.account_key
JOIN dim_date d ON f.date_key = d.date_key
WHERE d.fiscal_year IN ('2025')
  AND a.account_type IN ('expense')
GROUP BY account_group, fiscal_period
ORDER BY "Total" DESC
LIMIT 200;
```

### Column Pivot (entity as column dimension)
```sql
PIVOT (
    SELECT a.account_group, d.fiscal_period, e.entity_name, f.net_amount
    FROM financial_transactions f
    JOIN dim_account a ON f.account_key = a.account_key
    JOIN dim_date d ON f.date_key = d.date_key
    JOIN dim_entity e ON f.entity_key = e.entity_key
    WHERE d.fiscal_year IN ('2025')
)
ON entity_name
USING SUM(net_amount)
GROUP BY account_group, fiscal_period;
```

### With Scenario Comparison
```sql
WITH actuals AS (
    SELECT account_group, fiscal_period,
           SUM(net_amount) AS actual_total
    FROM financial_transactions f
    JOIN dim_account a ON f.account_key = a.account_key
    JOIN dim_date d ON f.date_key = d.date_key
    WHERE d.fiscal_year IN ('2025')
      AND f.data_layer = 'actuals'
    GROUP BY account_group, fiscal_period
),
scenario AS (
    SELECT account_group, fiscal_period,
           SUM(COALESCE(s.new_amount, f.net_amount)) AS scenario_total
    FROM financial_transactions f
    JOIN dim_account a ON f.account_key = a.account_key
    JOIN dim_date d ON f.date_key = d.date_key
    LEFT JOIN scenario_overrides s 
        ON f.row_id = s.row_id AND s.scenario_id = 'sc_001'
    WHERE d.fiscal_year IN ('2025')
      AND f.data_layer = 'actuals'
    GROUP BY account_group, fiscal_period
)
SELECT 
    COALESCE(a.account_group, s.account_group) AS account_group,
    COALESCE(a.fiscal_period, s.fiscal_period) AS fiscal_period,
    a.actual_total,
    s.scenario_total,
    s.scenario_total - a.actual_total AS delta,
    ROUND((s.scenario_total - a.actual_total) / NULLIF(ABS(a.actual_total), 0) * 100, 1) AS delta_pct
FROM actuals a
FULL OUTER JOIN scenario s USING (account_group, fiscal_period)
ORDER BY fiscal_period, actual_total;
```

### With Subtotals (GROUP BY ROLLUP)
```sql
SELECT 
    COALESCE(account_group, '** TOTAL **') AS account_group,
    COALESCE(fiscal_period, '** TOTAL **') AS fiscal_period,
    SUM(net_amount) AS total,
    GROUPING(account_group) AS is_group_total,
    GROUPING(fiscal_period) AS is_period_total
FROM financial_transactions f
JOIN dim_account a ON f.account_key = a.account_key
JOIN dim_date d ON f.date_key = d.date_key
GROUP BY ROLLUP(account_group, fiscal_period)
ORDER BY is_group_total, account_group, is_period_total, fiscal_period;
```

## Frontend Integration

The frontend minimum viable change:

1. **Replace data loading** — instead of fetching the full baseline, fetch `/api/v1/metadata/{model_id}` on mount to populate field selectors
2. **Pivot state → API call** — when user changes row fields, column field, value field, or filters, POST to `/api/v1/pivot` with 300ms debounce
3. **React Query with `keepPreviousData: true`** — keeps the current table visible while the new query loads, preventing layout flash
4. **Render server results directly** — the response is already in the shape the table component needs (columns + rows array)

The client-side `computePivot()`, `applyRules()`, `applyFilters()` functions are eliminated entirely. The frontend becomes a configuration UI that sends pivot specs and renders results.
