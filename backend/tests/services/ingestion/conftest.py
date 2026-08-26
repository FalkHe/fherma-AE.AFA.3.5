"""Fixtures for the ingestion layer tests.

Nothing here opens a socket: every fetch test drives a `MockTransport`, the
extraction tests read HTML from `fixtures/`, and the source adapters are driven
by recorded API responses from the same directory. The network is never a
dependency of this suite — that is what `app ingest fetch-url` and
`app ingest probe` are for.
"""

import json
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest

from app.core.config import get_settings

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def html_fixture() -> Callable[[str], str]:
    """Return a loader for the saved HTML pages in `fixtures/`."""

    def load(name: str) -> str:
        return (FIXTURES / name).read_text(encoding="utf-8")

    return load


@pytest.fixture
def json_fixture() -> Callable[[str], Any]:
    """Return a loader for the recorded API responses in `fixtures/`."""

    def load(name: str) -> Any:
        return json.loads((FIXTURES / name).read_text(encoding="utf-8"))

    return load


@pytest.fixture
def settings_override(monkeypatch: pytest.MonkeyPatch) -> Iterator[Callable[..., None]]:
    """Return a setter for settings the ingestion layer reads at call time."""

    def override(**environment: object) -> None:
        for key, value in environment.items():
            monkeypatch.setenv(key, str(value))
        get_settings.cache_clear()

    yield override
    get_settings.cache_clear()
