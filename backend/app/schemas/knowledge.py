from __future__ import annotations

import logging
from datetime import datetime

from pydantic import BaseModel, ConfigDict

logger = logging.getLogger(__name__)


class KnowledgeCreate(BaseModel):
    entry_type: str
    plain_text: str
    dataset_id: str | None = None
    content: dict = {}
    confidence: str = "confirmed"
    source: str = "user"


class KnowledgeUpdate(BaseModel):
    plain_text: str | None = None
    content: dict | None = None
    confidence: str | None = None


class KnowledgeResponse(BaseModel):
    id: str
    model_id: str
    dataset_id: str | None = None
    entry_type: str
    plain_text: str
    content: dict
    confidence: str | None = None
    source: str
    created_at: datetime
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)
