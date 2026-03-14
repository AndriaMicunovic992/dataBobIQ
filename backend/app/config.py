from __future__ import annotations

import logging
from functools import cached_property

from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Database
    database_url: str = (
        "postgresql://dataBobIQ:dataBobIQ@localhost:5432/dataBobIQ"
    )

    # Anthropic
    anthropic_api_key_chat: str = ""
    anthropic_api_key_agent: str = ""

    # Storage
    upload_dir: str = "./uploads"
    data_dir: str = "./data"

    # CORS
    cors_origins: str = "http://localhost:5173"

    # ------------------------------------------------------------------ #
    # Derived URLs                                                         #
    # ------------------------------------------------------------------ #

    @cached_property
    def async_database_url(self) -> str:
        url = self.database_url
        if url.startswith("postgresql://"):
            return url.replace("postgresql://", "postgresql+asyncpg://", 1)
        if url.startswith("postgresql+psycopg2://"):
            return url.replace("postgresql+psycopg2://", "postgresql+asyncpg://", 1)
        return url

    @cached_property
    def sync_database_url(self) -> str:
        url = self.database_url
        if url.startswith("postgresql://"):
            return url.replace("postgresql://", "postgresql+psycopg2://", 1)
        if url.startswith("postgresql+asyncpg://"):
            return url.replace("postgresql+asyncpg://", "postgresql+psycopg2://", 1)
        return url

    @cached_property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
