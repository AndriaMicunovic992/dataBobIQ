# Coding Conventions

## Python (Backend)

### Naming
- **snake_case** for functions, variables, modules
- **PascalCase** for SQLAlchemy models and Pydantic schemas
- **UPPER_CASE** for module-level constants
- Private helpers prefixed with `_`

### Imports
- Group: stdlib → third-party → app-internal (separated by blank lines)
- Use `from __future__ import annotations` in all modules
- Models: `from app.models.metadata import Dataset, Scenario, ...`
- Schemas: `from app.schemas.pivot import PivotRequest, PivotResponse`
- Services: `from app.services.pivot_engine import execute_pivot`

### Database Patterns
- **Dependency injection**: Routes receive `db: AsyncSession = Depends(get_db)`
- **Async queries**: `await db.execute(select(Model).where(...))` → `.scalars().all()`
- **Eager loading**: Use `selectinload()` for relationships needed in response
- **UUIDs as strings**: All primary keys are `String` with `server_default=func.gen_random_uuid().cast(String)`
- **No analytical data in PostgreSQL** — only metadata tables

### DuckDB Patterns
- **Thread-local connections** via `get_duckdb_conn()` from `duckdb_engine.py`
- **Parameterized queries** — never string-interpolate user values into SQL
- **Read Parquet directly** — `read_parquet('path/to/file.parquet')` in SQL
- **Return dicts/lists** — convert DuckDB results to Python dicts before returning from services
- **Register datasets as views** — `CREATE OR REPLACE VIEW ds_{id} AS SELECT * FROM read_parquet(...)`

### Pydantic Schemas
- Request models: `*Request` suffix (e.g., `PivotRequest`)
- Response models: `*Response` suffix (e.g., `PivotResponse`)
- Create/Update: `*Create`, `*Update` suffix
- Use `model_config = ConfigDict(from_attributes=True)` for ORM compatibility
- Optional fields use `X | None = None`

### Error Handling
- Raise `HTTPException(status_code=4xx, detail="...")` in route handlers
- Service functions raise plain exceptions; routes catch and convert
- Log warnings with `logger.warning(...)` for non-fatal issues
- Never silently swallow exceptions

### Polars (Ingestion Only)
- Used only in `parser.py`, `materializer.py`, and ingestion pipeline
- Always use `pl.DataFrame` / `pl.LazyFrame`
- Cast with `strict=False` to avoid crashes on bad data
- Handle `Utf8View` → `pl.String` normalization before casts

### File Organization
- **Route files** are thin — validate input, call service, format response
- **Service files** contain business logic — never import FastAPI types
- **Schema files** define API contracts — no business logic
- **Model files** define database structure — no business logic
- Each route file registers its own `APIRouter` included in `main.py`

## JavaScript (Frontend)

### Style
- **camelCase** for variables and functions
- Component files are PascalCase (e.g., `PivotView.jsx`)
- No TypeScript (plain JSX) — keep it simple for MVP
- Styles via `theme.js` constants and inline style objects

### State Management
- **React Query** for all server state (pivots, metadata, scenarios, knowledge)
- **useState** for local UI state (selected fields, expanded panels)
- Query keys: `["pivot", modelId, pivotConfig]`, `["metadata", modelId]`, etc.
- **No client-side data computation** — all aggregation comes from the server

### API Client (`api.js`)
- All functions use `req()` helper with `/api` prefix
- POST/PUT bodies via `json(body)` helper
- Streaming chat uses raw `fetch` + `ReadableStream`
- Upload uses `FormData`

### Component Patterns
- Each view in its own file under `components/`
- Shared UI primitives in `components/common/`
- Custom hooks in `hooks/` for data fetching patterns
- Props for configuration, React Query for data

## Git
- Commit messages: imperative mood, concise
- One logical change per commit
- Never commit `.env`, `uploads/`, `data/`, `__pycache__/`, `node_modules/`
