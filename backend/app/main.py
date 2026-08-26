"""FastAPI application factory.

Started as `uvicorn app.main:create_app --factory`.
"""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.endpoints import auth, documents, events, health, images, operations, products
from app.api.endpoints.events import LISTENER_STATE_ATTRIBUTE
from app.api.jsonapi import JsonApiError, json_api_error_handler
from app.core.config import Settings, get_settings
from app.services.notification_listener import NotificationListener

# The Vite dev server origin; credentials are allowed because the SPA
# authenticates with a session cookie.
CORS_ALLOWED_ORIGINS = ["http://localhost:5173"]


def _configure_logging(settings: Settings) -> None:
    """Send standard Python logging to stdout at the configured level."""
    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
    )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Run one `app_events` listener for as long as this process serves traffic.

    The listener is started without waiting for the database: it reconnects on
    its own, so neither a slow nor a dead PostgreSQL can delay startup, and a
    listener outage costs live updates only — never liveness or readiness.
    """
    listener = NotificationListener()
    setattr(app.state, LISTENER_STATE_ATTRIBUTE, listener)
    listener.start()
    try:
        yield
    finally:
        await listener.stop()


def create_app() -> FastAPI:
    """Build and configure the FastAPI application."""
    settings = get_settings()
    _configure_logging(settings)

    app = FastAPI(
        title="Motorcycle Buying Advisor API",
        version=__version__,
        docs_url="/docs" if settings.environment == "development" else None,
        redoc_url=None,
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Domain failures of the JSON:API resources render as an error document;
    # request validation and the auth dependencies keep FastAPI's own bodies.
    app.add_exception_handler(JsonApiError, json_api_error_handler)

    app.include_router(health.router)
    # Authentication is plain JSON and exempt from JSON:API, hence no /api.
    app.include_router(auth.router, prefix="/auth")
    # Plain SSE, not JSON:API, but part of the credentials-allowing /api surface.
    app.include_router(events.router, prefix="/api")
    app.include_router(documents.router, prefix="/api")
    app.include_router(images.router, prefix="/api")
    app.include_router(operations.router, prefix="/api")
    app.include_router(products.router, prefix="/api")

    return app
