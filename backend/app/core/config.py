"""Typed application settings, loaded from environment variables and `.env`."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

# .../backend/app/core/config.py -> repository root
_REPO_ROOT = Path(__file__).resolve().parents[3]

Environment = Literal["development", "production"]
LogLevel = Literal["CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"]

# Web search backends behind `app.services.ingestion.search.SearchProvider`.
SearchProviderName = Literal["tavily"]


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

    # Ingestion: where retained payloads live and how much of a remote page we
    # are willing to spend time and memory on.
    data_dir: Path = Path("/app/var/data")
    ingestion_fetch_timeout_seconds: float = 20
    ingestion_max_fetch_bytes: int = 5_242_880

    # Images: where the downloaded originals and their generated variants live.
    # Served read-only by the `/media` static mount.
    media_dir: Path = Path("/app/var/media")

    # Ingestion: the web-search half. An empty key is a valid configuration —
    # ingestion then runs Wikipedia-only with a warning.
    search_provider: SearchProviderName = "tavily"
    tavily_api_key: str = ""
    ingestion_max_web_documents: int = 6

    # LLM access: OpenRouter is the only gateway. An empty key is a valid
    # configuration (the app starts, model calls report the missing key).
    openrouter_api_key: str = ""
    chat_model: str = "openai/gpt-4.1-mini"

    # Specification extraction: the character-based input budget (no tokenizer
    # dependency) one extraction call may spend on source documents.
    extraction_max_input_chars: int = 60_000

    # Chunking: the structural splitter's target slice size and the overlap
    # carried between two neighbouring slices, both in characters.
    chunk_size_chars: int = 3_200
    chunk_overlap_chars: int = 400


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings instance (usable with `Depends`)."""
    return Settings()
