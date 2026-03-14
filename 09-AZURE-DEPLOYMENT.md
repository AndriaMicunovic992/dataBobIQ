# Azure Deployment Architecture

## Service Selection: Azure Container Apps

Azure Container Apps (ACA) is the deployment target. It's the right choice for a startup MVP because it scales to zero (no cost when idle), offers a generous free tier, natively supports multi-container environments, and has first-class FastAPI support documented by Microsoft.

Rejected alternatives:
- **Azure App Service** — doesn't scale to zero on the consumption tier, more expensive for comparable compute
- **AKS (Kubernetes)** — massive operational overhead for a small team, minimum ~$150/month
- **Azure Functions** — poor fit for long-running FastAPI processes and SSE streaming

## Container Architecture

Three containers share an ACA Environment with unified networking:

### Container 1: API Server
- **Image:** FastAPI + DuckDB + Uvicorn
- **Scaling:** 0→N replicas based on HTTP request count
- **Resources:** 1 vCPU, 2GB RAM per replica
- **Handles:** All REST API requests, SSE chat streaming, pivot queries
- **DuckDB:** Embedded, reads Parquet from Blob Storage via Azure extension

### Container 2: Background Worker
- **Image:** ARQ worker + DuckDB + Polars
- **Scaling:** 0→N replicas, KEDA-triggered from Redis queue depth
- **Resources:** 2 vCPU, 4GB RAM per replica (heavier for file parsing)
- **Handles:** File parsing, schema analysis, Parquet materialization, scenario rule application
- **Writes to:** Blob Storage (Parquet files) and PostgreSQL (metadata)

### Container 3: Redis
- **Service:** Azure Cache for Redis, Basic C0 (250MB)
- **Purpose:** ARQ job queue, optional query result cache
- **Alternative:** Can use a Redis sidecar container to save $16/month at the cost of persistence

## Azure Services

| Service | SKU | Purpose | Monthly Cost |
|---------|-----|---------|-------------|
| Container Apps | Consumption plan | API + Worker containers | $0–15 |
| Container Registry | Basic | Docker image storage | $5 |
| PostgreSQL Flexible | Burstable B1ms (1 vCPU, 2GB) | Metadata database | $13–15 |
| Blob Storage | Hot tier, LRS, ~50GB | Raw uploads + Parquet files | $1–2 |
| Cache for Redis | Basic C0 (250MB) | Job queue | $16 |
| Key Vault | Standard | Secrets (API keys, connection strings) | ~$0 |
| **Total** | | | **$35–55/month** |

## Network Architecture

```
Internet
    │
    ▼
┌─────────────────────────────────────────────┐
│  Azure Container Apps Environment           │
│                                             │
│  ┌──────────────┐    ┌──────────────────┐  │
│  │  API Server   │    │  Background      │  │
│  │  (FastAPI)    │    │  Worker (ARQ)    │  │
│  │              │    │                  │  │
│  │  DuckDB ←────┼────┼── Blob Storage   │  │
│  │  (embedded)  │    │   (Parquet R/W)  │  │
│  └──────┬───────┘    └────────┬─────────┘  │
│         │                     │             │
│         ├─────────────────────┤             │
│         │    Internal VNet    │             │
│         ▼                     ▼             │
│  ┌──────────────┐    ┌──────────────────┐  │
│  │  PostgreSQL   │    │  Redis Cache     │  │
│  │  (metadata)   │    │  (job queue)     │  │
│  └──────────────┘    └──────────────────┘  │
└─────────────────────────────────────────────┘
```

All services communicate over Azure's internal virtual network. PostgreSQL and Redis are not publicly exposed.

## Environment Variables

```bash
# Azure services
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...
AZURE_STORAGE_CONTAINER=databobiq-data
DATABASE_URL=postgresql+asyncpg://user:pass@server.postgres.database.azure.com/databobiq
DATABASE_URL_SYNC=postgresql://user:pass@server.postgres.database.azure.com/databobiq
REDIS_URL=rediss://default:pass@cache.redis.cache.windows.net:6380/0

# AI
ANTHROPIC_API_KEY_CHAT=sk-ant-...
ANTHROPIC_API_KEY_AGENT=sk-ant-...

# App
CORS_ORIGINS=https://app.databobiq.com
ENVIRONMENT=production
```

## Dockerfile (Updated)

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

# Install DuckDB system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 && rm -rf /var/lib/apt/lists/*

COPY --from=frontend /frontend/dist static/
COPY backend/pyproject.toml .
RUN pip install . --no-cache-dir

COPY backend/app/ app/
COPY backend/alembic/ alembic/
COPY backend/alembic.ini .

EXPOSE 8000
CMD alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
```

## CI/CD Pipeline

GitHub Actions → Azure Container Registry → Container Apps:

1. Push to `main` triggers build
2. Docker image built with multi-stage Dockerfile
3. Image pushed to Azure Container Registry
4. Container Apps revision updated via `az containerapp update`
5. Health check at `/api/health` confirms deployment

## Scaling Considerations

**API Server scaling:**
- Scale-to-zero when no requests (cost = $0 when idle)
- Scale up based on concurrent HTTP connections
- Each replica has its own DuckDB instance (read-only, no coordination needed)
- Target: 1 replica handles 50 concurrent users comfortably

**Worker scaling:**
- Scale-to-zero when job queue is empty
- KEDA trigger: scale up when Redis queue length > 0
- Each worker handles one file at a time (sequential within worker, parallel across replicas)
- Large file processing: 500K-row Excel takes ~5–15 seconds with calamine

**PostgreSQL scaling:**
- B1ms (1 vCPU, 2GB) handles metadata workload easily
- Upgrade to B2s if write throughput from many concurrent uploads becomes an issue
- Connection pooling via PgBouncer if needed (built into Azure Flexible Server)

**Blob Storage:**
- Effectively unlimited — no scaling concerns
- Hot tier for recent data, Cool tier for archived raw uploads (auto-tiering policy)

## Startup Credits

Azure for Startups offers $1,000 immediately to new customers, expandable to $5,000 with business verification. Startups with affiliated investor referrals can access $100,000 through the Investor Network track. At $35–55/month burn rate, the initial $1,000 covers roughly 18–28 months of infrastructure.
