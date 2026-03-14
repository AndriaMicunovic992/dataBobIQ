# DataBobIQ MVP Architecture Overview

## Core Thesis

Stop sending 500K rows to the browser. Move all pivoting, aggregation, and scenario computation to **DuckDB embedded inside FastAPI**, return only summarized results (typically 10–500 rows) via a REST pivot API, and use **PostgreSQL exclusively for metadata and user state**. This hybrid architecture handles datasets from 1K to 500K+ rows in under 100ms per query, costs roughly $35–55/month on Azure, and requires no infrastructure beyond what a small team can manage.

## What Changes from the Current Architecture

| Concern | Current State | Proposed State |
|---------|--------------|----------------|
| **Analytical queries** | Client-side JS pivot on full dataset | Server-side DuckDB SQL, returns aggregated results |
| **Data storage** | Dynamic `ds_*` PostgreSQL tables per sheet | Parquet files in Azure Blob Storage |
| **Metadata** | PostgreSQL (models, datasets, columns, scenarios) | PostgreSQL — same role, expanded schema |
| **Fact table selection** | User must manually choose | Single canonical `financial_transactions` model; custom types auto-classified |
| **Baseline loading** | Entire joined dataset sent as JSON to frontend | Frontend sends pivot config, receives 10–500 aggregated rows |
| **Scenario computation** | Client-side `applyRules()` in JS + server Polars | Server-side DuckDB with delta overlay pattern |
| **KPIs** | Not formalized — ad hoc in chat tools | Declarative YAML definitions with dependency graph |
| **File parsing** | Polars + fastexcel/openpyxl in request handler | Background worker (ARQ) with calamine engine |
| **Deployment** | Railway (Docker) | Azure Container Apps + Blob Storage + PostgreSQL Flexible |

## Tech Stack

| Layer | Technology | Role |
|-------|-----------|------|
| **API** | FastAPI (Python 3.11+) | REST endpoints, SSE streaming chat |
| **Analytical Engine** | DuckDB (embedded) | All pivoting, aggregation, scenario computation, variance |
| **Ingestion** | Polars + calamine | Excel/CSV parsing and type inference |
| **Metadata DB** | PostgreSQL (Azure Flexible Server) | Users, models, datasets, scenarios, KPIs, semantic layer |
| **Object Storage** | Azure Blob Storage | Raw uploads + processed Parquet files |
| **Background Jobs** | ARQ (async Redis queue) | File parsing, AI schema analysis, heavy transforms |
| **Cache/Queue** | Azure Cache for Redis | Job queue for ARQ, optional query cache |
| **AI** | Anthropic Claude API | Schema mapping agent, scenario chat agent |
| **Frontend** | React 18 + Vite | Thin pivot configuration UI, renders server results |
| **Deployment** | Azure Container Apps | Scale-to-zero containers for API + worker |

## Design Principles

1. **The frontend is a thin renderer.** It sends pivot configurations and receives pre-aggregated results. Zero CPU-intensive computation in the browser.

2. **One known fact type for MVP.** `financial_transactions` is the only canonical schema. Everything else is "custom" with AI-assisted column classification. New canonical types (workforce, sales) ship as future modules.

3. **Parquet as the analytical layer.** Raw data lives in Blob Storage as Parquet. DuckDB reads Parquet directly — no need to load data into PostgreSQL for analytical queries.

4. **Delta overlays for scenarios.** Scenarios store only changed values, not full copies of the dataset. Merging happens at query time via `COALESCE` joins.

5. **KPIs are configuration, not code.** Defined in YAML, evaluated via a dependency graph. AI-readable, user-modifiable, version-controllable.

6. **Incremental migration.** Each component can be built and deployed alongside the existing architecture. No big-bang rewrite required.
