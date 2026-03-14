# Stage 1: Build React frontend
FROM node:18-slim AS frontend
WORKDIR /build
COPY frontend/package*.json frontend/
COPY frontend/ frontend/
COPY backend/ backend/
RUN cd frontend && npm ci && npm run build

# Stage 2: Python backend with DuckDB
FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 && rm -rf /var/lib/apt/lists/*
COPY backend/pyproject.toml .
COPY backend/app/ app/
RUN pip install . --no-cache-dir
COPY backend/alembic/ alembic/
COPY backend/alembic.ini .
COPY --from=frontend /build/backend/static static/
RUN mkdir -p uploads data
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
