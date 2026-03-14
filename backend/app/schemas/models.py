from __future__ import annotations

import logging
from datetime import datetime

from pydantic import BaseModel, ConfigDict

logger = logging.getLogger(__name__)


class ModelCreate(BaseModel):
    name: str
    description: str | None = None


class ModelUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    settings: dict | None = None


class ModelResponse(BaseModel):
    id: str
    name: str
    description: str | None = None
    status: str
    settings: dict | None = None
    created_at: datetime
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)
