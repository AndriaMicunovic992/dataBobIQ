from __future__ import annotations

import logging

from pydantic import BaseModel

logger = logging.getLogger(__name__)


class ChatMessage(BaseModel):
    role: str  # user|assistant
    content: str


class ChatRequest(BaseModel):
    message: str
    dataset_id: str
    model_id: str
    history: list[ChatMessage] = []
    agent_mode: str = "data_understanding"  # data_understanding|scenario
