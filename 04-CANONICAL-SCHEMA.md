# Canonical Schema & Fact Types

## Philosophy: Magnets, Not Molds

Known fact types attract data that roughly fits, accommodate variation gracefully, and degrade smoothly when columns are missing or extra. The rigid approach — "your data must have exactly these columns or we reject it" — would be worse than having no type system. The flexible approach — "I need at least an amount, an account, and a date; I'll happily take whatever else you've got" — gives 80% of the benefit with none of the friction.

## Three-Tier Column Model

Every known fact type defines columns in three tiers:

### Core (Required)
The minimum that makes this fact type meaningful. If these can't be mapped, the upload doesn't match this type and falls to custom. The core set is deliberately tiny — typically 1–2 measures and 1–2 dimensions.

### Expected (Optional, Auto-Mapped)
Columns the system looks for and maps automatically when present. When missing, the fact table has NULL foreign keys for those dimensions. Queries that group by a missing dimension show everything as "unassigned." The system still functions — just with less analytical depth.

### Extensions (Flexible)
Any additional columns from the upload beyond core + expected. Stored as-is with their original names, typed by the AI. Fully queryable, filterable, and usable in scenarios. The only limitation: they don't participate in cross-fact joins automatically because no other fact type declares a relationship to them.

## MVP Fact Type: `financial_transactions`

```yaml
financial_transactions:
  grain: "One monetary posting to an account in a period"
  
  core:
    measures:
      - amount:
          type: currency
          description: "Net monetary value"
          aliases:
            - betrag
            - wert
            - value
            - saldo
            - balance
            - total
            - sum
            - umsatz
    dimensions:
      - account:
          shared_dim: dim_account
          description: "Account code from chart of accounts"
          aliases:
            - konto
            - hauptkonto
            - hk
            - sachkonto
            - gl_account
            - account_code
            - account_number
            - kontonummer
      - period:
          shared_dim: dim_date
          description: "Fiscal period"
          aliases:
            - periode
            - monat
            - month
            - datum
            - date
            - buchungsdatum
            - posting_date
            - fiscal_period
            - year_month
  
  expected:
    measures:
      - debit_amount:
          type: currency
          aliases: [soll, debit]
      - credit_amount:
          type: currency
          aliases: [haben, credit]
    dimensions:
      - cost_center:
          shared_dim: dim_cost_center
          aliases:
            - kostenstelle
            - kst
            - cost_centre
            - cc
            - department
            - abteilung
      - entity:
          shared_dim: dim_entity
          aliases:
            - gesellschaft
            - company
            - company_code
            - firma
            - buchungskreis
            - legal_entity
      - counter_account:
          description: "Offsetting account in double-entry"
          aliases: [gegenkonto, offset_account]
      - document_number:
          description: "Voucher/posting reference"
          aliases: [belegnummer, beleg, voucher, document_id]
      - posting_text:
          description: "Free text description"
          aliases: [buchungstext, text, description, bezeichnung]
  
  extensions: "any"
  
  system_columns:
    - data_layer: "actuals | budget | forecast | scenario:{id}"
    - source_key: "FK to dim_source for lineage"
    - row_id: "Synthetic unique row identifier"
```

## Custom Fact Type

Everything that doesn't match `financial_transactions` (or future known types) becomes custom:

- **No canonical schema** — columns are classified by AI as measure/dimension/time/key/ignore
- **No automatic cross-fact joins** — relationships must be explicitly defined
- **No pre-built KPIs** — all derived metrics must be defined per dataset
- **Full analytical capability** — pivoting, filtering, aggregation, scenarios all work identically through the same DuckDB engine

Custom types are stored with the same Parquet + metadata pattern as known types. The only difference is the absence of canonical column names and shared dimension foreign keys.

## Handling Structural Variation

### Upload has fewer columns than expected

Example: Small business GL export with only `account`, `period`, `amount`.

**Result:** Matches `financial_transactions` on core columns. Expected dimensions (`cost_center`, `entity`, etc.) have NULL keys. Pre-built KPIs that depend only on account + period + amount work immediately. KPIs requiring cost center show "no data available for this dimension."

### Upload has more columns than expected

Example: Enterprise GL with `account`, `period`, `amount`, `cost_center`, `entity`, `project`, `contract_type`, `approval_status`, `currency_code`.

**Result:** Core and expected columns mapped canonically. `project`, `contract_type`, `approval_status`, `currency_code` stored as extension columns. All are queryable in pivots and usable as scenario rule filters. If `project` later needs to cross-reference with time tracking data, a bridge table is created.

### Upload has different grain than expected

Example: Monthly summarized trial balance (one row per account per month) vs detailed daily postings.

**Result:** Both match `financial_transactions` — the grain difference is in date resolution (monthly vs daily). `dim_date` links work for both since YYYY-MM periods and YYYY-MM-DD dates both map to the calendar. Aggregation to monthly/quarterly is correct for both. The system records `time_grain: monthly` or `time_grain: daily` in dataset metadata for UI display.

### Upload has different sign conventions

Example: Company A stores expenses as negative. Company B stores everything positive with a debit/credit flag.

**Result:** The AI detects this during schema analysis and notes it in the mapping config. For Company B, the materialization step computes `net_amount = debit_amount - credit_amount` (or vice versa based on convention). The `dim_account.account_type` flag (revenue/expense/asset/liability) helps the AI determine the correct sign convention. This is stored as a Knowledge entry so future uploads from the same source use the same logic.

## Module Expansion Path

Known fact types are added based on observed customer demand, not speculation:

| Phase | Fact Type | Trigger Signal |
|-------|-----------|---------------|
| **MVP** | `financial_transactions` | Core product |
| **Module 2** | `time_entries` | 3+ customers uploading Tempo/Harvest, same Data Agent conversations |
| **Module 3** | `invoice_lines` | Demand for revenue analytics beyond GL summaries |
| **Module 4** | `headcount_plan` | Demand for workforce planning scenarios |
| **Future** | `sales_pipeline` | CRM integration requests |

Each new module ships as a configuration package:
- Fact type YAML definition (core/expected/extension columns)
- New dimension tables if needed (dim_person, dim_project, dim_customer)
- Default KPI set for the domain
- AI mapping prompt template with domain-specific aliases
- Bridge table templates for cross-fact joins with financials

## Cross-Fact Queries

When the user selects measures from multiple fact types in a pivot, the backend detects this and builds a multi-CTE query joining through shared dimensions:

```sql
WITH financial AS (
    SELECT dc.department, dd.fiscal_period,
           SUM(f.net_amount) AS total_cost
    FROM financial_transactions f
    JOIN dim_date dd ON f.date_key = dd.date_key
    JOIN dim_cost_center dc ON f.cost_center_key = dc.cost_center_key
    WHERE f.account_type = 'expense'
    GROUP BY dc.department, dd.fiscal_period
),
hours AS (
    SELECT dc.department, dd.fiscal_period,
           SUM(f.billable_hours) AS total_hours
    FROM time_entries f
    JOIN dim_date dd ON f.date_key = dd.date_key
    JOIN dim_cost_center dc ON f.cost_center_key = dc.cost_center_key
    GROUP BY dc.department, dd.fiscal_period
)
SELECT 
    COALESCE(f.department, h.department) AS department,
    COALESCE(f.fiscal_period, h.fiscal_period) AS fiscal_period,
    f.total_cost,
    h.total_hours,
    f.total_cost / NULLIF(h.total_hours, 0) AS cost_per_hour
FROM financial f
FULL OUTER JOIN hours h 
    ON f.department = h.department 
   AND f.fiscal_period = h.fiscal_period
```

The shared dimension (`dim_cost_center.department`) makes this possible. Without conformed dimensions, the user would need to manually specify how cost centers in the GL map to teams in Tempo.

For custom types with no shared dimension, cross-fact queries require an explicit bridge table — which the Data Agent helps create through conversation.
