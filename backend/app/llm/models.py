"""The canonical chat-model factory: LangChain over OpenRouter, nothing else.

`get_chat_model()` is the single place where a chat model is built. OpenRouter
is the only gateway (never the OpenAI API directly), the default model comes
from configuration, and observability callbacks are attached centrally — so a
caller only ever decides *which* model, never *how* to reach it.
"""

from langchain_core.callbacks.base import BaseCallbackHandler
from langchain_openrouter import ChatOpenRouter

from app.core.config import Settings, get_settings

# OpenRouter attribution (sent as HTTP-Referer / X-Title by the integration).
# Deliberately constants and not configuration: they identify this application
# in the OpenRouter dashboard and are the same in every environment.
APP_TITLE = "Motorcycle Buying Advisor"
APP_URL = "https://github.com/TuringCollegeSubmissions/fherma-AE.AFA.3.5"


class MissingApiKeyError(RuntimeError):
    """Raised when a model is requested without `OPENROUTER_API_KEY` configured.

    A dedicated type so callers (CLI commands, jobs) can report a configuration
    problem as such instead of surfacing a validation traceback.
    """

    def __init__(self) -> None:
        super().__init__("OPENROUTER_API_KEY is not configured.")


def observability_callbacks(settings: Settings) -> list[BaseCallbackHandler]:
    """Return the LangChain callback handlers every model is built with.

    This is the Langfuse slot: Phase 5 adds the `LANGFUSE_*` configuration and
    returns the handler here — gated on those settings, empty when they are
    absent — and every model built by `get_chat_model` is traced without a
    single call site changing. Until then the list is deliberately empty.
    """
    return []


def get_chat_model(model: str | None = None) -> ChatOpenRouter:
    """Return a chat model talking to OpenRouter.

    `model` overrides the configured default (`CHAT_MODEL`) and takes an
    OpenRouter model identifier such as `openai/gpt-4.1-mini`.
    """
    settings = get_settings()
    if not settings.openrouter_api_key:
        raise MissingApiKeyError

    return ChatOpenRouter(
        model=model or settings.chat_model,
        api_key=settings.openrouter_api_key,
        app_url=APP_URL,
        app_title=APP_TITLE,
        callbacks=observability_callbacks(settings) or None,
    )
