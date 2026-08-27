"""The `manufacturers` resource: the admin's reference list of brands.

Read-only and admin-only. The whole router carries `current_admin` — reads
included, like every other administrative surface here — and there is no write
route at all: rows appear through `manufacturer_service.get_or_create`, called
by extraction and by `app catalogue set-manufacturer`. Nothing to CSRF-protect,
therefore, and no error code beyond the pinned `not-found`.

Customer-facing exposure (a catalogue brand filter) is a Phase-4 decision.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import jsonapi
from app.api.deps import current_admin
from app.api.schemas.manufacturers import (
    ManufacturerAttributes,
    ManufacturerDocument,
    ManufacturerListDocument,
    ManufacturerResource,
)
from app.db.models.manufacturer import Manufacturer
from app.db.session import get_db_session
from app.services import manufacturer_service

router = APIRouter(
    prefix="/manufacturers",
    tags=["manufacturers"],
    dependencies=[Depends(current_admin)],
)

SessionDep = Annotated[AsyncSession, Depends(get_db_session)]
ManufacturerIdDep = Annotated[str, Path(description="ULID of the manufacturer.")]


def _resource(manufacturer: Manufacturer) -> ManufacturerResource:
    """Project a brand row onto a resource object."""
    return ManufacturerResource(
        id=manufacturer.id,
        attributes=ManufacturerAttributes.model_validate(manufacturer),
    )


async def _get_or_404(session: AsyncSession, manufacturer_id: str) -> Manufacturer:
    """Load a brand row or fail with the pinned 404 error document.

    `get_by_ids` is the service's only read-by-id entry point (the `get_specs`
    pattern); asking it for a single id keeps this module free of its own query.
    """
    manufacturers = await manufacturer_service.get_by_ids(session, [manufacturer_id])
    manufacturer = manufacturers.get(manufacturer_id)
    if manufacturer is None:
        raise jsonapi.JsonApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not-found",
            detail=f"No manufacturer with id '{manufacturer_id}'.",
        )
    return manufacturer


@router.get(
    "",
    response_model=ManufacturerListDocument,
    summary="List manufacturers",
)
async def list_manufacturers(
    session: SessionDep, page: jsonapi.PaginationDep
) -> ManufacturerListDocument:
    """Return one page of the brand list, alphabetically by name."""
    manufacturers, total = await manufacturer_service.list_manufacturers(
        session, limit=page.limit, offset=page.offset
    )
    return ManufacturerListDocument(
        data=[_resource(manufacturer) for manufacturer in manufacturers],
        meta=jsonapi.Meta(total_count=total),
    )


@router.get(
    "/{manufacturer_id}",
    response_model=ManufacturerDocument,
    summary="Read a manufacturer",
    responses=jsonapi.error_responses(status.HTTP_404_NOT_FOUND),
)
async def get_manufacturer(
    session: SessionDep, manufacturer_id: ManufacturerIdDep
) -> ManufacturerDocument:
    """Return one manufacturer."""
    manufacturer = await _get_or_404(session, manufacturer_id)
    return ManufacturerDocument(data=_resource(manufacturer))
