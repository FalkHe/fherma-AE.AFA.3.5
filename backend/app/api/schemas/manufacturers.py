"""Schemas for the `manufacturers` resource.

Wire shape is pinned by `docs/roadmap/phase-2b/shared-knowledge.md`: resource
type `manufacturers`, camelCase attributes `name`, `slug`, `description`,
`logoPath`, `createdAt`, `updatedAt` — `null` for the two columns no writer
fills yet.

**Read-only on purpose**, so there is no request model here: a brand row is
created only by `manufacturer_service.get_or_create` (extraction and the
`catalogue set-manufacturer` CLI). `logoPath` is the MEDIA_DIR-relative path of
the model, not a URL — nothing serves brand logos yet.
"""

from datetime import datetime
from typing import Literal

from pydantic import ConfigDict

from app.api.jsonapi import Document, JsonApiModel, ListDocument, Resource

MANUFACTURER_TYPE = "manufacturers"


class ManufacturerAttributes(JsonApiModel):
    """The pinned attribute set of a manufacturer."""

    # Built straight from the ORM row: every attribute is a column.
    model_config = ConfigDict(from_attributes=True)

    name: str
    slug: str
    description: str | None
    logo_path: str | None
    created_at: datetime
    updated_at: datetime


class ManufacturerResource(Resource[ManufacturerAttributes]):
    """A manufacturer resource object."""

    type: Literal["manufacturers"] = MANUFACTURER_TYPE


class ManufacturerDocument(Document[ManufacturerResource]):
    """Body of `GET /api/manufacturers/{id}`."""


class ManufacturerListDocument(ListDocument[ManufacturerResource]):
    """Body of `GET /api/manufacturers`."""
