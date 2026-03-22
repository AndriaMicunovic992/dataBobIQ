from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, model_validator

logger = logging.getLogger(__name__)


# Mapping from frontend knowledge_type values to backend entry_type values
_TYPE_MAP = {
    "business_rule": "note",
    "metric_definition": "calculation",
    "data_note": "note",
    "context": "note",
    "assumption": "note",
}

_REVERSE_TYPE_MAP = {
    "definition": "business_rule",
    "relationship": "context",
    "calculation": "metric_definition",
    "note": "data_note",
    "transformation": "data_note",
}


class KnowledgeCreate(BaseModel):
    # Backend fields (used by chat agent / programmatic callers)
    entry_type: str | None = None
    plain_text: str | None = None
    content: dict | str = {}

    # Frontend fields (used by KnowledgePanel UI)
    title: str | None = None
    knowledge_type: str | None = None
    tags: list[str] = []

    dataset_id: str | None = None
    confidence: str = "confirmed"
    source: str = "user"

    @model_validator(mode="after")
    def _normalize_fields(self) -> "KnowledgeCreate":
        # Map frontend knowledge_type → backend entry_type
        if not self.entry_type and self.knowledge_type:
            self.entry_type = _TYPE_MAP.get(self.knowledge_type, "note")
        if not self.entry_type:
            self.entry_type = "note"

        # Map frontend title+content(str) → backend plain_text+content(dict)
        if not self.plain_text:
            self.plain_text = self.title or ""

        if isinstance(self.content, str):
            text_content = self.content
            self.content = {
                "description": text_content,
            }
            if self.title:
                self.content["subject"] = self.title
            if self.tags:
                self.content["tags"] = self.tags

        return self

    def to_db_dict(self) -> dict[str, Any]:
        """Return only the fields that map to DB columns."""
        return {
            "entry_type": self.entry_type,
            "plain_text": self.plain_text,
            "content": self.content if isinstance(self.content, dict) else {},
            "confidence": self.confidence,
            "source": self.source,
            "dataset_id": self.dataset_id,
        }


class KnowledgeUpdate(BaseModel):
    entry_type: str | None = None
    plain_text: str | None = None
    content: dict | str | None = None
    confidence: str | None = None
    title: str | None = None
    knowledge_type: str | None = None
    tags: list[str] | None = None

    @model_validator(mode="after")
    def _normalize_fields(self) -> "KnowledgeUpdate":
        if self.title and not self.plain_text:
            self.plain_text = self.title
        if self.knowledge_type and not self.entry_type:
            self.entry_type = _TYPE_MAP.get(self.knowledge_type, "note")
        if isinstance(self.content, str):
            self.content = {"description": self.content}
        return self


class KnowledgeResponse(BaseModel):
    id: str
    model_id: str
    dataset_id: str | None = None
    entry_type: str
    plain_text: str
    content: dict | str
    confidence: str | None = None
    source: str
    created_at: datetime
    updated_at: datetime | None = None

    # Frontend-friendly aliases
    title: str | None = None
    knowledge_type: str | None = None
    tags: list[str] = []

    model_config = ConfigDict(from_attributes=True)

    @model_validator(mode="after")
    def _populate_frontend_fields(self) -> "KnowledgeResponse":
        # Derive title from plain_text or content
        if not self.title:
            if isinstance(self.content, dict):
                self.title = self.content.get("subject") or self.content.get("term") or self.plain_text
            else:
                self.title = self.plain_text

        # Derive knowledge_type from entry_type
        if not self.knowledge_type:
            self.knowledge_type = _REVERSE_TYPE_MAP.get(self.entry_type, "data_note")

        # Derive tags from content
        if not self.tags and isinstance(self.content, dict):
            self.tags = self.content.get("tags", [])

        # Ensure content is returned as string for frontend display
        if isinstance(self.content, dict):
            self.content = (
                self.content.get("description")
                or self.content.get("formula_display")
                or self.plain_text
            )

        return self
