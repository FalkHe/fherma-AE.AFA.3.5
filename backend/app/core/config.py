"""Typed application settings, loaded from environment variables and `.env`."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

# .../backend/app/core/config.py -> repository root
_REPO_ROOT = Path(__file__).resolve().parents[3]

Environment = Literal["development", "production"]
LogLevel = Literal["CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"]


class Settings(BaseSettings):
    """Application configuration.

    Values come from the process environment (how the Docker containers are
    configured) and fall back to a `.env` file for local, non-container runs.
    A missing required value fails fast at startup instead of being guessed.
    """

    model_config = SettingsConfigDict(
        env_file=(".env", _REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str
    redis_url: str
    environment: Environment = "development"
    log_level: LogLevel = "INFO"


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings instance (usable with `Depends`)."""
    return Settings()
