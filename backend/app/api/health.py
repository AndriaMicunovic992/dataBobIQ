from __future__ import annotations

import logging
import os

from fastapi import APIRouter

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check() -> dict:
    """Return service status and current process memory usage."""
    import psutil

    process = psutil.Process(os.getpid())
    mem_mb = round(process.memory_info().rss / 1024 / 1024, 1)
    logger.debug("Health check: memory_mb=%s", mem_mb)
    return {"status": "ok", "memory_mb": mem_mb}
