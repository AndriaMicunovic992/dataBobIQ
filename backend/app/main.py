from __future__ import annotations

# IMPORTANT: Set POLARS_MAX_THREADS before any polars import to limit memory usage.
import os

os.environ.setdefault("POLARS_MAX_THREADS", "2")

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings

logger = logging.getLogger(__name__)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan: create required directories on startup."""
    upload_dir = Path(settings.upload_dir)
    data_dir = Path(settings.data_dir)

    upload_dir.mkdir(parents=True, exist_ok=True)
    data_dir.mkdir(parents=True, exist_ok=True)

    logger.info("Upload dir: %s", upload_dir.resolve())
    logger.info("Data dir:   %s", data_dir.resolve())

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
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
    except (ImportError, ModuleNotFoundError) as _exc:
        logger.debug("Router %s not available yet (%s) — skipping.", _module_path, _exc)

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
