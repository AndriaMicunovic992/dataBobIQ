from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.metadata import KnowledgeEntry, Model
from app.schemas.knowledge import (
    KnowledgeCreate,
    KnowledgeResponse,
    KnowledgeUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["knowledge"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_entry_or_404(entry_id: str, db: AsyncSession) -> KnowledgeEntry:
    result = await db.execute(
        select(KnowledgeEntry).where(KnowledgeEntry.id == entry_id)
    )
    entry = result.scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Knowledge entry {entry_id} not found")
    return entry


# ---------------------------------------------------------------------------
# Knowledge CRUD
# ---------------------------------------------------------------------------


@router.post("/models/{model_id}/knowledge", response_model=KnowledgeResponse, status_code=201)
async def create_knowledge_entry(
    model_id: str,
    body: KnowledgeCreate,
    db: AsyncSession = Depends(get_db),
) -> KnowledgeResponse:
    """Create a knowledge base entry for a model."""
    result = await db.execute(select(Model).where(Model.id == model_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")

    entry = KnowledgeEntry(model_id=model_id, **body.model_dump())
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    logger.info(
        "Created knowledge entry id=%s model_id=%s type=%s",
        entry.id,
        model_id,
        entry.entry_type,
    )
    return KnowledgeResponse.model_validate(entry)


@router.get("/models/{model_id}/knowledge", response_model=list[KnowledgeResponse])
async def list_knowledge_entries(
    model_id: str,
    dataset_id: str | None = Query(None, description="Filter by dataset ID"),
    entry_type: str | None = Query(None, description="Filter by entry type"),
    db: AsyncSession = Depends(get_db),
) -> list[KnowledgeResponse]:
    """List knowledge base entries for a model with optional filters."""
    result = await db.execute(select(Model).where(Model.id == model_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")

    query = (
        select(KnowledgeEntry)
        .where(KnowledgeEntry.model_id == model_id)
        .order_by(KnowledgeEntry.created_at.desc())
    )
    if dataset_id is not None:
        query = query.where(KnowledgeEntry.dataset_id == dataset_id)
    if entry_type is not None:
        query = query.where(KnowledgeEntry.entry_type == entry_type)

    result = await db.execute(query)
    entries = result.scalars().all()
    return [KnowledgeResponse.model_validate(e) for e in entries]


@router.put("/knowledge/{entry_id}", response_model=KnowledgeResponse)
async def update_knowledge_entry(
    entry_id: str,
    body: KnowledgeUpdate,
    db: AsyncSession = Depends(get_db),
) -> KnowledgeResponse:
    """Update a knowledge base entry."""
    entry = await _get_entry_or_404(entry_id, db)

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(entry, field, value)

    await db.commit()
    await db.refresh(entry)
    logger.info("Updated knowledge entry id=%s", entry_id)
    return KnowledgeResponse.model_validate(entry)


@router.delete("/knowledge/{entry_id}", status_code=204)
async def delete_knowledge_entry(
    entry_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a knowledge base entry."""
    entry = await _get_entry_or_404(entry_id, db)
    await db.delete(entry)
    await db.commit()
    logger.info("Deleted knowledge entry id=%s", entry_id)
