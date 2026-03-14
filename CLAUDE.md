# dataBobIQ — Agent Context

A CFO companion platform powered by AI. Users upload ERP/accounting exports
(xlsx/csv), an AI agent classifies and maps columns to a canonical financial
schema, and a chat agent helps explore data, build KPIs, and create what-if
scenarios — all computed server-side via DuckDB.

## Tech Stack

| Layer | Technology | Role |
|-------|-----------|------|
| API | Python 3.11+, FastAPI, SQLAlchemy 2 (async), Alembic | REST + SSE endpoints |
| Analytics | DuckDB (embedded in FastAPI process) | All pivoting, aggregation, scenario, variance |
| Ingestion | Polars + calamine | Excel/CSV parsing, type inference |
| Metadata DB | PostgreSQL (asyncpg for app, psycopg2 for migrations) | Users, models, datasets, scenarios, KPIs, knowledge |
| Background Jobs | FastAPI BackgroundTasks (MVP) → ARQ for production | File parsing, AI analysis, Parquet writes |
| AI | Anthropic Claude API (Sonnet for chat, Haiku for classification) | Schema mapping, scenario chat |
| Frontend | React 18, Vite 5, React Query v5, Recharts | Thin pivot config UI, renders server results |
| Deploy | Railway (Docker + PostgreSQL plugin) | Single container + managed PostgreSQL |

## Project Structure

```
dataBobIQ/
├── backend/
│   ├── app/
│   │   ├── main.py                    # FastAPI app, lifespan, CORS, static mount
│   │   ├── config.py                  # Pydantic Settings (env vars)
│   │   ├── database.py                # Async + sync PG engines, Base, get_db
│   │   ├── duckdb_engine.py           # DuckDB connection manager, Parquet registration
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   ├── models.py              # Model CRUD endpoints
│   │   │   ├── datasets.py            # Upload, list, delete dataset endpoints
│   │   │   ├── pivot.py               # POST /pivot — server-side aggregation
│   │   │   ├── metadata.py            # GET /metadata — dimensions, measures, values
│   │   │   ├── scenarios.py           # Scenario CRUD + compute endpoints
│   │   │   ├── kpis.py                # KPI definition + evaluation endpoints
│   │   │   ├── chat.py                # SSE streaming chat endpoint
│   │   │   ├── knowledge.py           # Knowledge CRUD endpoints
│   │   │   └── health.py              # Health check
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   └── metadata.py            # SQLAlchemy ORM models
│   │   ├── schemas/
│   │   │   ├── __init__.py
│   │   │   ├── models.py              # Model request/response schemas
│   │   │   ├── datasets.py            # Dataset schemas
│   │   │   ├── pivot.py               # Pivot request/response schemas
│   │   │   ├── scenarios.py           # Scenario schemas
│   │   │   ├── kpis.py                # KPI schemas
│   │   │   ├── chat.py                # Chat schemas
│   │   │   └── knowledge.py           # Knowledge schemas
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   ├── parser.py              # File parsing + type inference (Polars)
│   │   │   ├── ingestion.py           # Full ingestion pipeline orchestrator
│   │   │   ├── fact_classifier.py     # Fact type matching (core/expected/extension)
│   │   │   ├── column_mapper.py       # AI-assisted column → canonical mapping
│   │   │   ├── materializer.py        # Transform raw → Parquet + dimensions
│   │   │   ├── pivot_engine.py        # DuckDB pivot query builder
│   │   │   ├── scenario_engine.py     # Delta overlay rule application + merge
│   │   │   ├── kpi_engine.py          # Dependency graph KPI evaluator
│   │   │   ├── chat_engine.py         # Claude chat with tool-use + SSE
│   │   │   ├── schema_agent.py        # Claude schema analysis (one-shot)
│   │   │   ├── ai_context.py          # XML context builder for AI prompts
│   │   │   ├── calendar_svc.py        # Calendar dimension seeding
│   │   │   └── storage.py             # Parquet I/O helpers (read/write to disk)
│   │   └── fact_types/
│   │       ├── __init__.py
│   │       ├── registry.py            # Fact type registry (loads YAML definitions)
│   │       └── financial_transactions.yaml  # Core financial fact type definition
│   ├── alembic/
│   │   ├── env.py
│   │   └── versions/
│   ├── alembic.ini
│   ├── pyproject.toml
│   └── uploads/                       # Local file storage (Railway volume)
│       └── .gitkeep
├── frontend/
│   ├── src/
│   │   ├── main.jsx                   # React entry point
│   │   ├── App.jsx                    # Main layout, tab routing, model selection
│   │   ├── api.js                     # API client (fetch wrapper)
│   │   ├── theme.js                   # Colors, fonts, style constants
│   │   ├── components/
│   │   │   ├── ModelLanding.jsx        # Model selection / creation page
│   │   │   ├── UploadScreen.jsx        # Initial upload screen
│   │   │   ├── SchemaView.jsx          # Data model tab (schema + relationships)
│   │   │   ├── PivotView.jsx           # Actuals tab (server-side pivot)
│   │   │   ├── ScenarioView.jsx        # Scenarios tab
│   │   │   ├── ChatPanel.jsx           # AI chat sidebar
│   │   │   ├── KnowledgePanel.jsx      # Knowledge base CRUD
│   │   │   ├── FieldManager.jsx        # Dimension/measure field picker
│   │   │   ├── FilterManager.jsx       # Filter builder
│   │   │   ├── PivotTable.jsx          # Table rendering (server data)
│   │   │   ├── PivotChart.jsx          # Chart rendering (Recharts)
│   │   │   ├── WaterfallChart.jsx      # Waterfall/bridge chart
│   │   │   ├── UploadModal.jsx         # File upload modal
│   │   │   └── common/
│   │   │       ├── Button.jsx
│   │   │       ├── Badge.jsx
│   │   │       ├── Card.jsx
│   │   │       └── Table.jsx
│   │   └── hooks/
│   │       ├── usePivot.js             # React Query hook for pivot API
│   │       ├── useMetadata.js          # React Query hook for metadata API
│   │       └── useScenarios.js         # React Query hook for scenarios
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── docker-compose.yml                  # PostgreSQL for local dev
├── Dockerfile                          # Multi-stage: frontend build + backend
├── railway.toml                        # Railway deployment config
├── Makefile                            # Dev commands
├── .gitignore
├── README.md
└── .claude/
    ├── ARCHITECTURE.md                 # → points to /docs/*.md
    ├── CONVENTIONS.md                  # Coding standards
    ├── IMPLEMENTATION.md               # Phase-by-phase build instructions
    └── INTERFACES.md                   # Python interface contracts
```

## Dev Commands

```bash
make install       # pip install -e . + npm install
make dev           # docker-compose postgres + alembic migrate + uvicorn --reload
make frontend      # vite dev server on :5173
make migrate       # alembic upgrade head
make reset-db      # alembic downgrade base + upgrade head
```

## Environment Variables

Set in `backend/.env`:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL (auto-derived for async/sync) |
| `ANTHROPIC_API_KEY_CHAT` | Chat agent (Sonnet) |
| `ANTHROPIC_API_KEY_AGENT` | Schema agent (Haiku/Sonnet) |
| `UPLOAD_DIR` | File storage path (default: `./uploads`) |
| `DATA_DIR` | Parquet file storage (default: `./data`) |
| `CORS_ORIGINS` | Comma-separated allowed origins |

## Deployment (Railway)

- `railway.toml` + `Dockerfile` for deployment
- `DATABASE_URL` auto-converted: `postgresql://` → `postgresql+asyncpg://`
- Frontend built with `vite build`, served as static files from `backend/static/`
- Parquet files stored on Railway volume mount at `DATA_DIR`
- Background tasks use FastAPI `BackgroundTasks` (no Redis needed for MVP)
- Memory: set `POLARS_MAX_THREADS=2` in `main.py` before any Polars import

## Critical Rules

1. **DuckDB for all analytics** — every pivot, aggregation, scenario computation, variance, and KPI evaluation runs in DuckDB. Never load full datasets into Python memory for computation.
2. **PostgreSQL for metadata only** — models, datasets, scenarios, KPIs, knowledge, users. No analytical data in PostgreSQL.
3. **Parquet as analytical storage** — processed data stored as Parquet files. DuckDB reads them directly.
4. **Frontend is a thin renderer** — sends pivot configs, receives aggregated results (10–500 rows). Zero client-side aggregation.
5. **One canonical fact type for MVP** — `financial_transactions`. Everything else is custom with AI-assisted classification.
6. **Delta overlays for scenarios** — store only changed values, merge at query time with COALESCE.
7. **Polars for ingestion only** — file parsing and type inference. Not for analytical queries.
8. **Route files split by domain** — no monolithic routes.py. Each API domain has its own file.
9. **Frontend split into components** — no monolithic App.jsx. Each view is a separate file.

## Documentation

- **Architecture & design decisions**: See `docs/*.md` (numbered 01–10)
- **Coding conventions**: See `.claude/CONVENTIONS.md`
- **Implementation plan**: See `.claude/IMPLEMENTATION.md`
- **Interface contracts**: See `.claude/INTERFACES.md`
