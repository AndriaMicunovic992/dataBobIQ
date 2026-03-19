from __future__ import annotations

import json
import logging
from collections.abc import AsyncGenerator
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.metadata import Dataset, Model
from app.schemas.chat import ChatRequest
from app.services.ai_context import build_ai_context
from app.services.chat_engine import stream_chat

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])


async def _resolve_dataset_id(model_id: str, dataset_id: str | None, db: AsyncSession) -> str:
    """Return an explicit dataset_id or fall back to the first active dataset."""
    if dataset_id:
        return dataset_id
    result = await db.execute(
        select(Dataset.id)
        .where(Dataset.model_id == model_id, Dataset.status == "active")
        .limit(1)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="No active datasets found for this model")
    return row


async def _sse_generator(
    model_id: str,
    dataset_id: str,
    request: ChatRequest,
    context: str,
    agent_mode: str,
) -> AsyncGenerator[str, None]:
    """Wrap chat_engine.stream_chat() events as SSE-formatted strings."""
    try:
        history = [{"role": m.role, "content": m.content} for m in request.history]
        async for event_str in stream_chat(
            message=request.message,
            dataset_id=dataset_id,
            model_id=model_id,
            history=history,
            context=context,
            agent_mode=agent_mode,
        ):
            # stream_chat yields JSON strings; wrap as SSE
            yield f"data: {event_str}\n\n"
    except Exception as exc:
        logger.exception("Chat stream error for model %s: %s", model_id, exc)
        error_event: dict[str, Any] = {"type": "error", "message": str(exc)}
        yield f"data: {json.dumps(error_event)}\n\n"
    finally:
        yield "data: [DONE]\n\n"


@router.post("/models/{model_id}/chat")
async def chat(
    model_id: str,
    body: ChatRequest,
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Stream a chat response using Server-Sent Events.

    Each SSE event is a JSON object with a ``type`` field. Common types:
    - ``text_delta``: partial text chunk, ``{"type": "text_delta", "text": "..."}``
    - ``tool_use``: tool invocation, ``{"type": "tool_use", "name": "...", "input": {...}}``
    - ``tool_result``: tool output, ``{"type": "tool_result", "content": [...]}``
    - ``error``: error message, ``{"type": "error", "message": "..."}``
    - ``[DONE]``: stream termination sentinel (literal string, not JSON)
    """
    result = await db.execute(select(Model).where(Model.id == model_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")

    # Resolve dataset_id from model if not provided
    dataset_id = await _resolve_dataset_id(model_id, body.dataset_id, db)

    # Determine agent mode: frontend sends "mode", legacy sends "agent_mode"
    agent_mode = body.mode or body.agent_mode or "data"
    # Normalize mode names
    if agent_mode in ("data_understanding", "data"):
        agent_mode = "data"

    # Build AI context
    try:
        context = await build_ai_context(model_id, dataset_id, db)
    except Exception as exc:
        logger.warning("Failed to build AI context: %s", exc)
        context = "<data_context>Context unavailable</data_context>"

    logger.info(
        "Chat request model_id=%s dataset_id=%s mode=%s history=%d",
        model_id, dataset_id, agent_mode, len(body.history),
    )

    return StreamingResponse(
        _sse_generator(
            model_id=model_id,
            dataset_id=dataset_id,
            request=body,
            context=context,
            agent_mode=agent_mode,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
