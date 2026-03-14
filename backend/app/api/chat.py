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
from app.models.metadata import Model
from app.schemas.chat import ChatRequest
from app.services.chat_engine import stream_chat

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])


async def _sse_generator(
    model_id: str,
    request: ChatRequest,
    db: AsyncSession,
) -> AsyncGenerator[str, None]:
    """Wrap chat_engine.stream_chat() events as SSE-formatted strings."""
    try:
        async for event in stream_chat(model_id=model_id, request=request, db=db):
            yield f"data: {json.dumps(event)}\n\n"
    except Exception as exc:
        logger.exception("Chat stream error for model %s: %s", model_id, exc)
        error_event: dict[str, Any] = {"type": "error", "message": str(exc)}
        yield f"data: {json.dumps(error_event)}\n\n"
    finally:
        # Signal stream end
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

    The underlying chat engine uses Claude with tool-use to run DuckDB queries,
    pivot analyses, and KPI evaluations on behalf of the user.
    """
    result = await db.execute(select(Model).where(Model.id == model_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")

    logger.info(
        "Chat request model_id=%s messages=%d",
        model_id,
        len(body.messages),
    )

    return StreamingResponse(
        _sse_generator(model_id=model_id, request=body, db=db),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # Disable Nginx buffering
        },
    )
