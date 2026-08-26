"""Tests for the chat-model factory.

No completion is ever requested: these tests assert how the model is *wired*
(gateway, model id, attribution, callbacks) — that is the part the application
depends on, and it is observable on the constructed object.
"""

from collections.abc import Iterator

import pytest

from app.core.config import get_settings
from app.llm.models import (
    APP_TITLE,
    APP_URL,
    MissingApiKeyError,
    get_chat_model,
    observability_callbacks,
)

# Syntactically usable and deliberately never dialled, like the URLs pinned in
# the top-level conftest.
TEST_API_KEY = "test-openrouter-key"

CONFIGURED_MODEL = "anthropic/claude-3.5-haiku"


@pytest.fixture
def configured(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Provide a key and a non-default chat model through the environment."""
    monkeypatch.setenv("OPENROUTER_API_KEY", TEST_API_KEY)
    monkeypatch.setenv("CHAT_MODEL", CONFIGURED_MODEL)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def without_api_key(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Provide the empty-key configuration that ships in `.env.dist`."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.mark.usefixtures("configured")
def test_default_model_comes_from_settings() -> None:
    """Without an argument the factory uses `CHAT_MODEL`."""
    assert get_chat_model().model_name == CONFIGURED_MODEL


@pytest.mark.usefixtures("configured")
def test_model_argument_overrides_the_default() -> None:
    """An explicit model id wins over the configured default."""
    assert get_chat_model("openai/gpt-4.1").model_name == "openai/gpt-4.1"


@pytest.mark.usefixtures("configured")
def test_key_and_attribution_are_wired() -> None:
    """The configured key authenticates and this application is attributed."""
    chat = get_chat_model()

    assert chat.openrouter_api_key is not None
    assert chat.openrouter_api_key.get_secret_value() == TEST_API_KEY
    assert (chat.app_url, chat.app_title) == (APP_URL, APP_TITLE)


@pytest.mark.usefixtures("configured")
def test_no_callbacks_until_langfuse_is_wired() -> None:
    """The observability slot is empty in Phase 2 and attaches nothing."""
    assert observability_callbacks(get_settings()) == []
    assert get_chat_model().callbacks is None


@pytest.mark.usefixtures("without_api_key")
def test_missing_api_key_raises_a_configuration_error() -> None:
    """An empty key is reported as configuration, not as a validation error."""
    with pytest.raises(MissingApiKeyError, match="OPENROUTER_API_KEY is not configured"):
        get_chat_model()
