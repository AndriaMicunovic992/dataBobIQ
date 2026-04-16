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
    """Return an explicit dataset_id or fall back to the primary fact dataset.

    When the frontend doesn't pass a dataset_id, we need to pick the dataset
    the chat agent should default to for tools that don't specify
    ``dataset_name``. The seeded calendar/dimension tables are NEVER the
    right default — they don't contain the fact measures (amount, etc.).
    Prefer datasets whose ``fact_type`` is not ``dimension``; fall back to
    any active dataset only if nothing else exists.
    """
    if dataset_id:
        return dataset_id

    # First choice: an active fact/custom dataset (not a dimension table).
    result = await db.execute(
        select(Dataset.id)
        .where(
            Dataset.model_id == model_id,
            Dataset.status == "active",
            Dataset.fact_type != "dimension",
        )
        .order_by(Dataset.created_at.asc())
        .limit(1)
    )
    row = result.scalar_one_or_none()
    if row is not None:
        return row

    # Fallback: any active dataset.
    result = await db.execute(
        select(Dataset.id)
        .where(Dataset.model_id == model_id, Dataset.status == "active")
        .order_by(Dataset.created_at.asc())
        .limit(1)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="No active datasets found for this model")
    return row


async def _build_dataset_map(model_id: str, db: AsyncSession) -> dict[str, str]:
    """Build a name→id map for all active datasets in the model."""
    result = await db.execute(
        select(Dataset.name, Dataset.id)
        .where(Dataset.model_id == model_id, Dataset.status == "active")
    )
    return {name: ds_id for name, ds_id in result.all()}


def _translate_event(raw: dict[str, Any]) -> dict[str, Any]:
    """Translate chat_engine events to the format the frontend expects.

    Backend (chat_engine) emits: {"event": "<type>", "data": <payload>}
    Frontend (ChatPanel) expects: {"type": "<type>", ...flat fields}
    """
    event_type = raw.get("event", raw.get("type", "unknown"))
    data = raw.get("data")

    if event_type == "text_delta":
        # Frontend checks: event.type === 'text' and reads event.text
        return {"type": "text", "text": data or ""}

    if event_type == "tool_executing":
        # Frontend checks: event.type === 'tool_use', event.name, event.input
        info = data if isinstance(data, dict) else {}
        return {"type": "tool_use", "name": info.get("tool", ""), "input": info.get("input", {})}

    if event_type == "tool_result":
        info = data if isinstance(data, dict) else {}
        return {"type": "tool_result", "name": info.get("tool", ""), "content": json.dumps(info.get("result", ""), default=str)}

    if event_type == "scenario_created":
        info = data if isinstance(data, dict) else {}
        return {"type": "scenario_created", "name": info.get("name", "")}

    # Special tool events that should also surface as tool_result in the UI
    if event_type in ("scenario_rules", "knowledge_saved", "mapping_suggested"):
        info = data if isinstance(data, dict) else {}
        return {"type": "tool_result", "name": info.get("tool", event_type), "content": json.dumps(info.get("result", ""), default=str)}

    if event_type == "done":
        return {"type": "done"}

    if event_type == "error":
        return {"type": "error", "data": data or "Unknown error"}

    # Pass through anything else
    return {"type": event_type, "data": data}


async def _sse_generator(
    model_id: str,
    dataset_id: str,
    request: ChatRequest,
    context: str,
    agent_mode: str,
    dataset_map: dict[str, str] | None = None,
) -> AsyncGenerator[str, None]:
    """Wrap chat_engine.stream_chat() events as SSE-formatted strings."""
    done_sent = False

    try:
        history = [{"role": m.role, "content": m.content} for m in request.history]
        async for event_str in stream_chat(
            message=request.message,
            dataset_id=dataset_id,
            model_id=model_id,
            history=history,
            context=context,
            agent_mode=agent_mode,
            dataset_map=dataset_map,
        ):
            # stream_chat yields JSON strings; parse, translate, re-serialize
            try:
                raw_event = json.loads(event_str)
                translated = _translate_event(raw_event)
                if translated.get("type") == "done":
                    done_sent = True
                yield f"data: {json.dumps(translated)}\n\n"
            except (json.JSONDecodeError, TypeError):
                yield f"data: {event_str}\n\n"
    except Exception as exc:
        logger.exception("Chat stream error for model %s: %s", model_id, exc)
        error_event: dict[str, Any] = {"type": "error", "data": str(exc)}
        yield f"data: {json.dumps(error_event)}\n\n"
    finally:
        # Ensure the frontend always gets a terminal done + [DONE] pair.
        if not done_sent:
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
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

    # Build AI context and dataset map
    try:
        context = await build_ai_context(model_id, dataset_id, db)
    except Exception as exc:
        logger.warning("Failed to build AI context: %s", exc)
        context = "<data_context>Context unavailable</data_context>"

    dataset_map = await _build_dataset_map(model_id, db)

    logger.info(
        "Chat request model_id=%s dataset_id=%s mode=%s history=%d datasets=%d",
        model_id, dataset_id, agent_mode, len(body.history), len(dataset_map),
    )

    return StreamingResponse(
        _sse_generator(
            model_id=model_id,
            dataset_id=dataset_id,
            request=body,
            context=context,
            agent_mode=agent_mode,
            dataset_map=dataset_map,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
