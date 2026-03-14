from __future__ import annotations

import logging
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base

from app.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Async engine (used by FastAPI request handlers)
# ---------------------------------------------------------------------------
async_engine = create_async_engine(
    settings.async_database_url,
    echo=False,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
)

AsyncSessionLocal = async_sessionmaker(
    bind=async_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

# ---------------------------------------------------------------------------
# Sync engine (used by Alembic migrations only)
# ---------------------------------------------------------------------------
from sqlalchemy import create_engine  # noqa: E402 — after async engine

sync_engine = create_engine(
    settings.sync_database_url,
    echo=False,
    pool_pre_ping=True,
)

# ---------------------------------------------------------------------------
# Declarative base shared by all ORM models
# ---------------------------------------------------------------------------
Base = declarative_base()


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Yield an async database session; roll back on error."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
