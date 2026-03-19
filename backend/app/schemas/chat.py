from __future__ import annotations

import logging

from pydantic import BaseModel

logger = logging.getLogger(__name__)


class ChatMessage(BaseModel):
    role: str  # user|assistant
    content: str


class ChatRequest(BaseModel):
    message: str
    dataset_id: str | None = None  # optional; resolved from model datasets when omitted
    model_id: str | None = None  # optional; typically provided via URL path
    history: list[ChatMessage] = []
    mode: str = "data"  # data|scenario (frontend sends this)
    agent_mode: str | None = None  # deprecated alias for mode
