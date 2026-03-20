from __future__ import annotations

# IMPORTANT: Set POLARS_MAX_THREADS before any polars import to limit memory usage.
import os

os.environ.setdefault("POLARS_MAX_THREADS", "2")

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

import traceback

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings

logger = logging.getLogger(__name__)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan: create required directories and re-register DuckDB views."""
    upload_dir = Path(settings.upload_dir)
    data_dir = Path(settings.data_dir)

    upload_dir.mkdir(parents=True, exist_ok=True)
    data_dir.mkdir(parents=True, exist_ok=True)

    logger.info("Upload dir: %s", upload_dir.resolve())
    logger.info("Data dir:   %s", data_dir.resolve())

    # Re-register all active datasets' parquet files in DuckDB
    # (views are in-memory and lost on restart)
    try:
        from app.database import AsyncSessionLocal
        from app.models.metadata import Dataset, Scenario
        from app.duckdb_engine import register_dataset
        from app.services.storage import get_scenario_path
        from sqlalchemy import select

        async with AsyncSessionLocal() as db:
            # Re-register dataset views
            result = await db.execute(
                select(Dataset).where(
                    Dataset.status == "active",
                    Dataset.parquet_path.isnot(None),
                )
            )
            datasets = result.scalars().all()
            for ds in datasets:
                try:
                    register_dataset(ds.id, ds.parquet_path)
                except Exception as exc:
                    logger.warning(
                        "Failed to re-register dataset %s (%s): %s",
                        ds.id, ds.parquet_path, exc,
                    )
            logger.info("Re-registered %d active dataset views in DuckDB", len(datasets))

            # Re-register scenario views (parquet paths are deterministic)
            sc_result = await db.execute(select(Scenario))
            scenarios = sc_result.scalars().all()
            sc_count = 0
            for sc in scenarios:
                sc_path = get_scenario_path(str(data_dir), sc.model_id, sc.id)
                if Path(sc_path).exists():
                    try:
                        register_dataset(f"sc_{sc.id}", sc_path)
                        sc_count += 1
                    except Exception as exc:
                        logger.warning("Failed to re-register scenario %s: %s", sc.id, exc)
            if sc_count:
                logger.info("Re-registered %d scenario views in DuckDB", sc_count)
    except Exception as exc:
        logger.warning("Could not re-register DuckDB views on startup: %s", exc)

    yield

    logger.info("dataBobIQ API shutting down.")


app = FastAPI(
    title="dataBobIQ API",
    description="CFO companion platform — AI-powered financial analytics.",
    version="0.1.0",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Return error details in the response for debugging."""
    tb = traceback.format_exception(type(exc), exc, exc.__traceback__)
    logger.error("Unhandled exception on %s %s:\n%s", request.method, request.url.path, "".join(tb))
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc), "type": type(exc).__name__},
    )

# ---------------------------------------------------------------------------
# API routers
# ---------------------------------------------------------------------------
from app.api.health import router as health_router  # noqa: E402
from app.api.models import router as models_router  # noqa: E402

app.include_router(health_router, prefix="/api")
app.include_router(models_router, prefix="/api")

# Routers that depend on services — gracefully skipped if services not yet implemented
_optional_routers: list[tuple[str, str]] = [
    ("app.api.datasets", "datasets"),
    ("app.api.pivot", "pivot"),
    ("app.api.metadata", "metadata"),
    ("app.api.scenarios", "scenarios"),
    ("app.api.kpis", "kpis"),
    ("app.api.chat", "chat"),
    ("app.api.knowledge", "knowledge"),
]

for _module_path, _tag in _optional_routers:
    try:
        import importlib

        _mod = importlib.import_module(_module_path)
        _router = getattr(_mod, "router")
        app.include_router(_router, prefix="/api")
        logger.info("Loaded router: %s", _module_path)
    except Exception as _exc:
        logger.warning("Router %s failed to load: %s: %s", _module_path, type(_exc).__name__, _exc)

# ---------------------------------------------------------------------------
# Static frontend files (served only when the build output exists)
# ---------------------------------------------------------------------------
_static_dir = Path(__file__).parent / "static"
if _static_dir.exists() and _static_dir.is_dir():
    app.mount("/", StaticFiles(directory=str(_static_dir), html=True), name="frontend")
    logger.info("Serving frontend static files from %s", _static_dir)
else:
    logger.info(
        "No static/ directory found at %s — frontend must be served separately.",
        _static_dir,
    )
