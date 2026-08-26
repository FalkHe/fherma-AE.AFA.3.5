"""FastAPI application factory.

Started as `uvicorn app.main:create_app --factory`.
"""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.endpoints import auth, health, operations, products
from app.api.jsonapi import JsonApiError, json_api_error_handler
from app.core.config import Settings, get_settings

# The Vite dev server origin; credentials are allowed because the SPA
# authenticates with a session cookie.
CORS_ALLOWED_ORIGINS = ["http://localhost:5173"]


def _configure_logging(settings: Settings) -> None:
    """Send standard Python logging to stdout at the configured level."""
    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
    )


def create_app() -> FastAPI:
    """Build and configure the FastAPI application."""
    settings = get_settings()
    _configure_logging(settings)

    app = FastAPI(
        title="Motorcycle Buying Advisor API",
        version=__version__,
        docs_url="/docs" if settings.environment == "development" else None,
        redoc_url=None,
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
    app.include_router(operations.router, prefix="/api")
    app.include_router(products.router, prefix="/api")

    return app
