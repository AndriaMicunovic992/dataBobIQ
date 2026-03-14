# Migration Roadmap: Incremental, Not Big-Bang

## Principle

Each phase delivers immediate value and can be deployed alongside the existing architecture. No phase requires a full rewrite or breaks existing functionality. The current app continues working throughout the migration.

## Phase 1: Server-Side Pivot API (Weeks 1–3)

**Goal:** Eliminate client-side aggregation. Frontend stops loading full baselines.

**What to build:**
- DuckDB integration in FastAPI (embedded, thread-local connections)
- `/api/v1/pivot` endpoint that accepts pivot configuration and returns aggregated results
- `/api/v1/metadata/{model_id}` endpoint returning available dimensions, measures, value lists
- Query builder that translates pivot requests into DuckDB SQL
- Keep existing `ds_*` PostgreSQL tables — DuckDB reads from them via its `postgres` extension

**Frontend changes:**
- Replace `getBaseline()` call with `getMetadata()` on mount
- Replace client-side `computePivot()` with POST to `/api/v1/pivot`
- React Query with `keepPreviousData: true` for smooth re-pivots
- Remove ~500 lines of client-side pivot/filter/aggregation code

**What stays unchanged:**
- Upload flow, schema detection, AI agents, scenario storage
- PostgreSQL metadata layer
- Existing `ds_*` tables (DuckDB reads from them directly)

**Validation:** Side-by-side comparison — same pivot config should produce identical numbers from old client-side engine and new server-side engine.

## Phase 2: Parquet + Blob Storage (Weeks 3–5)

**Goal:** Move analytical data from PostgreSQL dynamic tables to Parquet in Blob Storage.

**What to build:**
- Azure Blob Storage integration (upload raw files, write processed Parquet)
- Updated ingestion pipeline: parse → Parquet → Blob Storage (instead of → PostgreSQL table)
- DuckDB queries switch from `postgres_scan()` to `read_parquet()`
- Background worker setup with ARQ + Redis
- Blob storage layout: `raw/`, `processed/`, `scenarios/`

**Migration of existing data:**
- One-time script reads each `ds_*` table, writes to Parquet, uploads to Blob
- Update dataset records with Parquet paths
- Old `ds_*` tables kept temporarily as fallback, dropped after validation

**What stays unchanged:**
- PostgreSQL metadata, scenarios, knowledge entries
- Frontend (already talks to pivot API from Phase 1)
- AI agents (tool implementations updated to use DuckDB)

## Phase 3: Canonical Schema — Financial Core (Weeks 5–8)

**Goal:** Introduce the `financial_transactions` canonical model with shared dimensions.

**What to build:**
- Fact type registry (YAML definitions in codebase)
- Fact type classification during ingestion (core/expected/extension column matching)
- AI-assisted column mapping (Claude suggests raw → canonical mapping)
- User review/confirmation UI for mappings
- Shared dimension tables: `dim_date`, `dim_account`, `dim_cost_center`, `dim_entity`
- Dimension extraction from chart-of-accounts uploads
- `data_layer` column for actuals/budget/forecast tagging

**Impact:**
- New uploads go through the canonical pipeline
- Existing datasets remain as-is (treated as custom type) until users choose to re-map them
- Cross-dataset queries become possible through shared dimensions
- Pre-built KPI set activates for properly mapped financial data

## Phase 4: Scenario Delta Overlays (Weeks 8–10)

**Goal:** Replace copy-on-write scenario engine with delta overlay pattern.

**What to build:**
- `scenario_rules` table in PostgreSQL (replaces JSON rules array on scenario record)
- `scenario_overrides` Parquet generation (only changed rows)
- DuckDB query builder for `COALESCE(override, baseline)` merge
- Server-side variance computation (replace client-side `ComparisonTable`)
- Server-side waterfall decomposition by rule
- Future period projection via template rows

**Impact:**
- Scenarios become instant to create (no full-dataset copy)
- Multi-scenario comparison runs server-side in milliseconds
- Waterfall charts show per-rule contribution

## Phase 5: KPI Engine (Weeks 10–12)

**Goal:** Declarative KPI definitions with dependency-graph evaluation.

**What to build:**
- KPI definition schema and storage in PostgreSQL
- Dependency graph resolver using `graphlib.TopologicalSorter`
- Expression evaluator using `simpleeval`
- Base measure → DuckDB SQL compiler
- KPI API endpoints (list, evaluate, define)
- Default P&L KPI set shipped with `financial_transactions` type
- AI agent tool: `get_kpi_values`

**Impact:**
- Standard financial KPIs available out of the box after mapping
- Users and AI can define custom KPIs
- KPIs automatically reflect scenario modifications

## Phase 6: Azure Deployment (Parallel, Weeks 2–4)

**Goal:** Move from Railway to Azure Container Apps.

**Can run in parallel with Phase 1–2:**
- Set up Azure Container Apps environment
- Configure PostgreSQL Flexible Server
- Set up Blob Storage account
- Configure Azure Cache for Redis
- CI/CD pipeline (GitHub Actions → ACR → ACA)
- DNS and SSL setup

## Summary Timeline

```
Week  1  2  3  4  5  6  7  8  9  10  11  12
      ├──────────┤                              Phase 1: Server-side pivot
         ├──────────┤                           Phase 6: Azure deployment (parallel)
               ├──────────┤                     Phase 2: Parquet + Blob
                     ├────────────────┤         Phase 3: Canonical schema
                                 ├──────────┤  Phase 4: Scenario overlays
                                       ├──────┤ Phase 5: KPI engine
```

Total: ~12 weeks for full migration. Each phase is independently deployable and valuable.

## Risk Mitigation

- **Phase 1 has the highest impact-to-effort ratio.** Even if nothing else ships, moving pivot computation server-side fixes the core scalability problem.
- **Existing data is never deleted** until the new path is validated. Parquet files in Blob Storage coexist with `ds_*` PostgreSQL tables during transition.
- **Feature flags** control which code path is active. New uploads can go through the canonical pipeline while existing datasets use the legacy path.
- **The frontend refactor is minimal.** Phases 1–5 are primarily backend changes. The frontend gets simpler (less client-side code), not more complex.
