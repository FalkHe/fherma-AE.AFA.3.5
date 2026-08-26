"""Shared fixtures for the backend test suite.

No test here may touch a real database: PostgreSQL is not running during a
plain `uv run pytest`. Routes that depend on a session receive a stub via
FastAPI's dependency overrides, so `app.db.session.get_engine()` is never
called — which also side-steps the `lru_cache`'d-engine / event-loop pitfall
described in `docs/qa-checklist.md`.
"""

from collections.abc import Callable, Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.db.session import get_db_session
from app.main import create_app


@pytest.fixture(scope="session", autouse=True)
def _settings_environment() -> Iterator[None]:
    """Pin the settings the app reads, so the developer's `.env` cannot leak in.

    The URLs are syntactically valid but deliberately never dialled.
    """
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("DATABASE_URL", "postgresql+psycopg://test:test@127.0.0.1:5432/test")
        patch.setenv("REDIS_URL", "redis://127.0.0.1:6379/0")
        patch.setenv("ENVIRONMENT", "development")
        patch.setenv("LOG_LEVEL", "WARNING")
        get_settings.cache_clear()
        yield
    get_settings.cache_clear()


class StubSession:
    """Stand-in for `AsyncSession`; only `execute()` is exercised so far."""

    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.statements: list[str] = []

    async def execute(self, statement: object) -> None:
        """Record the statement and raise the configured failure, if any."""
        self.statements.append(str(statement))
        if self.error is not None:
            raise self.error


@pytest.fixture
def api() -> FastAPI:
    """Return a freshly built application instance."""
    return create_app()


@pytest.fixture
def stub_db_session(api: FastAPI) -> Iterator[Callable[..., StubSession]]:
    """Return a factory that installs a `StubSession` as the session dependency."""

    def install(error: Exception | None = None) -> StubSession:
        session = StubSession(error)
        api.dependency_overrides[get_db_session] = lambda: session
        return session

    yield install
    api.dependency_overrides.clear()


@pytest.fixture
def client(api: FastAPI) -> Iterator[TestClient]:
    """Return a synchronous HTTP client bound to the application."""
    with TestClient(api) as test_client:
        yield test_client
