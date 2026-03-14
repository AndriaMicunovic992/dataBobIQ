# Implementation Plan

Step-by-step build instructions. Each phase is independently deployable.
Complete phases in order. Each task has a validation step.

---

## Phase 0: Project Scaffold (Day 1)

### Task 0.1: Initialize project structure
Create the full directory tree from CLAUDE.md. Initialize:
- `backend/pyproject.toml` with all dependencies
- `frontend/package.json` with all dependencies
- `docker-compose.yml` (PostgreSQL for local dev)
- `Dockerfile` (multi-stage: frontend build + backend)
- `railway.toml`
- `Makefile`
- `.gitignore`
- `backend/.env.example`

**Dependencies (backend/pyproject.toml):**
```
fastapi>=0.115.0
uvicorn[standard]>=0.34.0
sqlalchemy>=2.0.36
asyncpg>=0.30.0
psycopg2-binary>=2.9.0
alembic>=1.14.0
polars>=1.20.0
fastexcel>=0.12.0
openpyxl>=3.1.0
duckdb>=1.2.0
python-multipart>=0.0.18
pydantic>=2.10.0
pydantic-settings>=2.7.0
anthropic>=0.42.0
aiofiles>=24.1.0
python-dotenv>=1.0.0
psutil>=5.9.0
simpleeval>=1.0.0
pyyaml>=6.0.0
```

**Dependencies (frontend/package.json):**
```
react, react-dom (18.x)
@tanstack/react-query (5.x)
recharts (2.x)
lodash (4.x)
```

**Validate:** `cd backend && pip install -e .` succeeds. `cd frontend && npm install` succeeds.

### Task 0.2: Database setup
Create `backend/app/config.py`, `backend/app/database.py`, `backend/app/duckdb_engine.py`.
Create initial Alembic migration with all metadata tables.

**PostgreSQL Tables (Alembic migration 0001):**

```sql
-- models: workspace containers
CREATE TABLE models (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ
);

-- datasets: uploaded file registry
CREATE TABLE datasets (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    model_id TEXT REFERENCES models(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    source_filename TEXT,
    fact_type TEXT NOT NULL DEFAULT 'custom',  -- 'financial_transactions' | 'custom'
    mapping_config JSONB,                       -- confirmed column mappings
    parquet_path TEXT,                          -- path to processed Parquet file
    row_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'queued',      -- queued|parsing|parsed|mapping|mapped_pending_review|materializing|active|error|deleted
    data_layer TEXT DEFAULT 'actuals',          -- actuals|budget|forecast
    ai_analyzed BOOLEAN DEFAULT false,
    ai_notes JSONB,
    agent_context_notes JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ
);

-- dataset_columns: column catalog
CREATE TABLE dataset_columns (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    source_name TEXT NOT NULL,          -- original column name from file
    canonical_name TEXT,                -- mapped canonical name (null for custom)
    display_name TEXT NOT NULL,
    data_type TEXT NOT NULL,            -- text|numeric|integer|date|boolean|currency
    column_role TEXT NOT NULL DEFAULT 'attribute',  -- key|measure|time|attribute|ignore
    column_tier TEXT DEFAULT 'extension',  -- core|expected|extension (for known fact types)
    shared_dim TEXT,                    -- dim_account, dim_date, etc.
    unique_count INTEGER,
    sample_values JSONB,
    ai_suggestion JSONB,
    UNIQUE(dataset_id, source_name)
);

-- scenarios
CREATE TABLE scenarios (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    model_id TEXT REFERENCES models(id) ON DELETE CASCADE,
    dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    base_config JSONB,          -- {source, base_year, source_scenario_id}
    color TEXT,
    overrides_path TEXT,        -- path to overrides Parquet
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ
);

-- scenario_rules: individual rules within a scenario
CREATE TABLE scenario_rules (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
    priority INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL,
    rule_type TEXT NOT NULL,    -- multiplier|offset|set_value
    target_field TEXT NOT NULL,  -- which measure to modify
    adjustment JSONB NOT NULL,  -- {factor: 1.10} or {offset: -300000}
    filter_expr JSONB,          -- {account_type: ["expense"]}
    period_from TEXT,
    period_to TEXT,
    distribution TEXT DEFAULT 'proportional',  -- proportional|equal
    affected_rows INTEGER,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- kpi_definitions
CREATE TABLE kpi_definitions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    kpi_id TEXT NOT NULL,       -- short identifier: revenue, gross_profit
    label TEXT NOT NULL,
    kpi_type TEXT NOT NULL,     -- base_measure|derived
    expression JSONB NOT NULL,  -- SQL aggregation def or arithmetic expression
    depends_on JSONB DEFAULT '[]',
    format JSONB,               -- {type: currency, decimals: 0}
    is_default BOOLEAN DEFAULT false,  -- shipped with fact type
    status TEXT DEFAULT 'active',
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- knowledge_entries
CREATE TABLE knowledge_entries (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    dataset_id TEXT REFERENCES datasets(id) ON DELETE CASCADE,
    entry_type TEXT NOT NULL,   -- relationship|calculation|transformation|definition|note
    plain_text TEXT NOT NULL,
    content JSONB DEFAULT '{}',
    confidence TEXT,            -- confirmed|suggested|rejected
    source TEXT DEFAULT 'ai_agent',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ
);

-- semantic_columns
CREATE TABLE semantic_columns (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    column_name TEXT NOT NULL,
    description TEXT,
    synonyms JSONB DEFAULT '[]',
    value_source TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(dataset_id, column_name)
);

-- semantic_value_labels
CREATE TABLE semantic_value_labels (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    semantic_column_id TEXT NOT NULL REFERENCES semantic_columns(id) ON DELETE CASCADE,
    raw_value TEXT NOT NULL,
    display_label TEXT NOT NULL,
    category TEXT,
    sort_order INTEGER,
    UNIQUE(semantic_column_id, raw_value)
);

-- dataset_relationships
CREATE TABLE dataset_relationships (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    model_id TEXT REFERENCES models(id) ON DELETE CASCADE,
    source_dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    target_dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    source_column TEXT NOT NULL,
    target_column TEXT NOT NULL,
    relationship_type TEXT DEFAULT 'foreign_key',  -- foreign_key|bridge|conceptual
    coverage_pct INTEGER,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

**Validate:** `cd backend && alembic upgrade head` succeeds.

### Task 0.3: Health check + basic app
Create `main.py` with lifespan, CORS, health endpoint, static mount.
Create `api/health.py` with `/api/health` endpoint.

**Validate:** `uvicorn app.main:app --reload` starts. `curl localhost:8000/api/health` returns `{"status": "ok"}`.

### Task 0.4: Frontend scaffold
Create minimal React app with Vite, React Query provider, basic routing structure.
Copy visual theme constants from old project (colors, fonts, spacing).

**Validate:** `cd frontend && npm run dev` starts. `npm run build` succeeds.

---

## Phase 1: Server-Side Pivot API (Week 1–2)

### Task 1.1: DuckDB engine
Implement `duckdb_engine.py` — thread-local connections, dataset registration, query execution.
For MVP/Railway: Parquet files stored on local disk (not Blob Storage).

**Validate:** Unit test — register a test Parquet, execute `SELECT count(*) FROM ds_test`.

### Task 1.2: Storage helpers
Implement `services/storage.py` — Parquet read/write, directory structure.

### Task 1.3: File parser
Port `parser.py` from old project. Adapt to new column metadata format.
Output: parsed DataFrame + list of column metadata dicts.

### Task 1.4: Simple ingestion (no AI mapping yet)
Implement `services/ingestion.py` — parse file, auto-classify columns by heuristic,
write directly to Parquet, register in DuckDB. Skip AI mapping for Phase 1.
The dataset goes straight from parsed → Parquet → active.
Use FastAPI `BackgroundTasks` for async processing (no Redis/ARQ needed for MVP).
The upload endpoint saves the file, returns immediately with dataset_id + status="queued",
and the background task runs the full parse → Parquet → register pipeline.

### Task 1.5: Model + Dataset CRUD endpoints
Implement `api/models.py` and `api/datasets.py`.
Upload endpoint: receive file → call ingestion → return dataset metadata.

**Validate:** Upload an Excel file via curl/Swagger → dataset appears in list.

### Task 1.6: Pivot engine
Implement `services/pivot_engine.py` — build_pivot_sql, execute_pivot.
Handle: row dimensions, column dimension, measures, filters, totals, sort, limit.

### Task 1.7: Pivot + Metadata API endpoints
Implement `api/pivot.py` and `api/metadata.py`.

**Validate:** Upload Excel → GET /metadata returns columns + values → POST /pivot with row/col/value returns aggregated rows. Response should be <50 rows for a 500K dataset.

### Task 1.8: Frontend — pivot view
Build the Actuals tab that talks to the new pivot API:
- `useMetadata` hook loads dimensions/measures/values
- `FieldManager` picks row/col/value fields
- `FilterManager` builds filter state
- `usePivot` hook POSTs config to /pivot on every change (300ms debounce)
- `PivotTable` renders server results
- `PivotChart` renders Recharts bar chart from server results

**Validate:** Upload file → switch to Actuals tab → drag fields → see pivot table update.

---

## Phase 2: Canonical Schema + AI Mapping (Week 2–3)

### Task 2.1: Fact type registry
Create `fact_types/registry.py` and `fact_types/financial_transactions.yaml`.
Implement YAML loading and the FactTypeDefinition dataclass.

### Task 2.2: Fact classifier
Implement `services/fact_classifier.py` — match uploads against known types using alias lists.

### Task 2.3: AI column mapper
Implement `services/column_mapper.py` — Claude suggests raw → canonical mapping.

### Task 2.4: Materializer
Implement `services/materializer.py` — transform parsed data to canonical Parquet with dimension extraction.

### Task 2.5: Calendar dimension
Port `calendar_svc.py` — seed dim_date as Parquet.

### Task 2.6: Update ingestion pipeline
Wire fact classification + AI mapping into the ingestion flow.
Add "mapping review" status and confirmation endpoint.

### Task 2.7: Schema view in frontend
Build Data Model tab showing datasets, detected columns, AI mapping proposals,
and relationship management.

**Validate:** Upload a German GL export → AI classifies as financial_transactions → proposes column mapping → user confirms → Parquet materialized with canonical names → dim_account extracted.

---

## Phase 3: Scenario Engine (Week 3–4)

### Task 3.1: Scenario CRUD endpoints
Implement `api/scenarios.py` — create, list, update, delete scenarios and rules.

### Task 3.2: Scenario rule engine
Implement `services/scenario_engine.py` — apply_rule, recompute_scenario.
Write overrides to Parquet.

### Task 3.3: Scenario merge in pivot
Update `pivot_engine.py` to support scenario_ids parameter.
Build COALESCE join SQL for overlay merging.

### Task 3.4: Variance + waterfall computation
Implement compute_variance and execute_waterfall in scenario_engine.

### Task 3.5: Future period projection
Implement template-based projection for rules targeting non-existent periods.

### Task 3.6: Frontend — scenario view
Build Scenarios tab with rule editor, comparison table, waterfall chart.
All computation is server-side — frontend only configures and renders.

**Validate:** Create scenario "Revenue +10%" → rules applied → comparison table shows actuals vs scenario → waterfall shows contribution.

---

## Phase 4: KPI Engine (Week 4–5)

### Task 4.1: KPI definition storage
CRUD endpoints for KPI definitions.
Load default P&L KPIs when financial_transactions dataset is activated.

### Task 4.2: KPI evaluator
Implement `services/kpi_engine.py` — dependency graph, base measure SQL compilation,
derived measure expression evaluation.

### Task 4.3: KPI API endpoints
Implement `api/kpis.py` — list, evaluate, define.

### Task 4.4: KPI display in frontend
Add KPI summary cards to the Actuals and Scenarios views.

**Validate:** Upload GL + chart of accounts → P&L KPIs auto-activate → evaluate returns Revenue, Gross Profit, EBITDA values → scenario comparison shows KPI deltas.

---

## Phase 5: AI Chat Agents (Week 5–6)

### Task 5.1: AI context builder
Implement `services/ai_context.py` — build XML context from metadata + semantic layer + knowledge.

### Task 5.2: Chat engine
Implement `services/chat_engine.py` — tool-use loop, SSE streaming.
Tools execute DuckDB queries via execute_query() — never load full datasets.

### Task 5.3: Chat tools
Implement all tools for both agents:
- Data agent: query_data, list_dimension_values, save_knowledge, list_knowledge, suggest_mapping
- Scenario agent: query_data, list_dimension_values, create_scenario, add_scenario_rule, list_scenarios, compare_scenarios, get_kpi_values, list_knowledge

### Task 5.4: Knowledge CRUD
Implement `api/knowledge.py` endpoints.

### Task 5.5: Frontend — chat panel + knowledge
Build ChatPanel and KnowledgePanel components.

**Validate:** Ask "what's total revenue for 2025?" → agent calls query_data → returns number. Ask "increase revenue by 10% for 2026" → agent creates scenario → rules applied → variance computed.

---

## Phase 6: Polish + Deploy (Week 6–7)

### Task 6.1: Upload flow improvements
Multi-file upload, progress tracking, error handling.
Cached format recognition (skip AI mapping for known formats).

### Task 6.2: Saved views
Persist pivot configurations per model in model.settings.

### Task 6.3: Data layer tagging
Upload-time tagging for actuals/budget/forecast.
Budget vs actuals comparison in pivot API.

### Task 6.4: Onboarding checklist
Port the onboarding flow from old project, adapted for new workflow.

### Task 6.5: Railway deployment
Finalize Dockerfile and railway.toml for Railway:

**Dockerfile:**
```dockerfile
# Stage 1: Build React frontend
FROM node:18-slim AS frontend
WORKDIR /frontend
COPY frontend/package*.json .
RUN npm ci
COPY frontend/ .
RUN npm run build

# Stage 2: Python backend with DuckDB
FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 && rm -rf /var/lib/apt/lists/*
COPY --from=frontend /frontend/dist static/
COPY backend/pyproject.toml .
RUN pip install . --no-cache-dir
COPY backend/app/ app/
COPY backend/alembic/ alembic/
COPY backend/alembic.ini .
RUN mkdir -p uploads data
EXPOSE 8000
CMD alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
```

**railway.toml:**
```toml
[build]
builder = "dockerfile"
dockerfilePath = "Dockerfile"

[deploy]
healthcheckPath = "/api/health"
healthcheckTimeout = 30
```

**Railway setup:**
1. Create new project on Railway
2. Add PostgreSQL plugin (provides DATABASE_URL automatically)
3. Add volume mount for /app/data (Parquet storage persists across deploys)
4. Set environment variables: ANTHROPIC_API_KEY_CHAT, ANTHROPIC_API_KEY_AGENT, CORS_ORIGINS, DATA_DIR=/app/data, UPLOAD_DIR=/app/uploads
5. DATABASE_URL auto-converted in config.py: postgresql:// → postgresql+asyncpg://

**Important Railway-specific notes:**
- Railway PostgreSQL provides `DATABASE_URL` as `postgresql://...` — config.py must auto-derive both async and sync URLs
- Railway volumes persist data across deploys — mount at `/app/data` for Parquet files
- Set `POLARS_MAX_THREADS=2` in main.py before Polars import (Railway memory constraints)
- Health endpoint should report memory usage via psutil

**Validate:** Full end-to-end on Railway: upload → schema → pivot → scenario → chat → KPIs.

---

## Task Completion Checklist

Before marking ANY task complete:
- [ ] Backend server starts without import errors
- [ ] `alembic upgrade head` succeeds (if migration added)
- [ ] `npm run build` succeeds (if frontend changed)
- [ ] Changed endpoints return expected response shapes
- [ ] No hardcoded secrets or API keys
- [ ] No `print()` statements (use `logger`)
