"""The `products` resource: the admin's view of the motorcycle catalogue.

The whole router is admin-only (`current_admin`) and every write additionally
carries `csrf_protect` — this is an administrative surface, reads included.

Business rules stay in `product_service`: this module translates its exceptions
into the pinned JSON:API error codes (`duplicate-model`, `invalid-transition`)
and its rows into resource objects. In particular no status is ever assigned
here — only `product_service.transition` may change one, so the legal matrix
cannot be bypassed through the API.
"""

from collections.abc import Mapping, Sequence
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Path, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import jsonapi
from app.api.deps import csrf_protect, current_admin
from app.api.schemas.products import (
    DraftSpecRequest,
    ProductAttributes,
    ProductCreateRequest,
    ProductDocument,
    ProductListDocument,
    ProductPatchRequest,
    ProductResource,
    SpecAttributes,
)
from app.db.models.manufacturer import Manufacturer
from app.db.models.motorbike import Motorbike, MotorbikeStatus
from app.db.models.motorbike_spec import MotorbikeSpec, SpecKind
from app.db.session import get_db_session
from app.services import manufacturer_service, product_service

router = APIRouter(
    prefix="/products",
    tags=["products"],
    dependencies=[Depends(current_admin)],
)

SessionDep = Annotated[AsyncSession, Depends(get_db_session)]
ProductIdDep = Annotated[str, Path(description="ULID of the product.")]

STATUS_FILTER_DESCRIPTION = "Comma-separated list of statuses: " + ", ".join(
    member.value for member in MotorbikeStatus
)


def _draft_spec_values(draft_spec: DraftSpecRequest) -> dict[str, Any]:
    """Turn the request model into the service's full-object value mapping.

    Field names are the frozen column names, so a plain dump is the contract —
    the schema is the boundary that keeps unknown keys out. The two vocabulary
    fields dump as `StrEnum` members, which are strings for the database.
    """
    return draft_spec.model_dump()


def _spec_attributes(spec: MotorbikeSpec | None) -> SpecAttributes | None:
    """Project one specification row, or `None` when the revision is absent."""
    return None if spec is None else SpecAttributes.model_validate(spec)


def _manufacturer_name(
    motorbike: Motorbike, manufacturers: Mapping[str, Manufacturer]
) -> str | None:
    """Return the display name of a row's brand, or `None` when it has none.

    `manufacturer` is a derived attribute since Phase 2b: the catalogue row
    carries only the foreign key, and the wire shape carries only the name.
    """
    if motorbike.manufacturer_id is None:
        return None
    manufacturer = manufacturers.get(motorbike.manufacturer_id)
    return None if manufacturer is None else manufacturer.name


async def _manufacturers_of(
    session: AsyncSession, motorbikes: Sequence[Motorbike]
) -> Mapping[str, Manufacturer]:
    """Load the brands of a whole page of catalogue rows in one query."""
    return await manufacturer_service.get_by_ids(
        session,
        [
            motorbike.manufacturer_id
            for motorbike in motorbikes
            if motorbike.manufacturer_id is not None
        ],
    )


def _resource(
    motorbike: Motorbike,
    specs: Mapping[SpecKind, MotorbikeSpec],
    manufacturers: Mapping[str, Manufacturer],
) -> ProductResource:
    """Project a catalogue row plus its specifications onto a resource object."""
    return ProductResource(
        id=motorbike.id,
        attributes=ProductAttributes(
            name=motorbike.query_name,
            slug=motorbike.slug,
            manufacturer=_manufacturer_name(motorbike, manufacturers),
            model_name=motorbike.model_name,
            year_from=motorbike.year_from,
            year_to=motorbike.year_to,
            status=motorbike.status,
            draft_spec=_spec_attributes(specs.get(SpecKind.DRAFT)),
            verified_spec=_spec_attributes(specs.get(SpecKind.VERIFIED)),
            created_at=motorbike.created_at,
            updated_at=motorbike.updated_at,
        ),
    )


async def _document(session: AsyncSession, motorbike: Motorbike) -> ProductDocument:
    """Build the single-resource document for one catalogue row."""
    specs = await product_service.get_specs(session, [motorbike.id])
    manufacturers = await _manufacturers_of(session, [motorbike])
    return ProductDocument(data=_resource(motorbike, specs.get(motorbike.id, {}), manufacturers))


async def _get_or_404(session: AsyncSession, product_id: str) -> Motorbike:
    """Load a catalogue row or fail with the pinned 404 error document."""
    motorbike = await product_service.get_motorbike(session, product_id)
    if motorbike is None:
        raise jsonapi.JsonApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not-found",
            detail=f"No product with id '{product_id}'.",
        )
    return motorbike


def _parse_status_filter(raw: str | None) -> list[MotorbikeStatus] | None:
    """Turn `filter[status]` into statuses; `None` means unfiltered."""
    members = jsonapi.parse_filter(raw)
    if members is None:
        return None

    try:
        return [MotorbikeStatus(member) for member in members]
    except ValueError as error:
        raise jsonapi.JsonApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid-filter",
            detail=f"{STATUS_FILTER_DESCRIPTION}.",
        ) from error


@router.get(
    "",
    response_model=ProductListDocument,
    summary="List products",
    responses=jsonapi.error_responses(status.HTTP_400_BAD_REQUEST),
)
async def list_products(
    session: SessionDep,
    page: jsonapi.PaginationDep,
    status_filter: Annotated[
        str | None,
        Query(alias="filter[status]", description=STATUS_FILTER_DESCRIPTION),
    ] = None,
) -> ProductListDocument:
    """Return one page of the catalogue, newest first."""
    statuses = _parse_status_filter(status_filter)
    motorbikes, total = await product_service.list_motorbikes(
        session, statuses=statuses, limit=page.limit, offset=page.offset
    )
    specs = await product_service.get_specs(session, [motorbike.id for motorbike in motorbikes])
    manufacturers = await _manufacturers_of(session, motorbikes)

    return ProductListDocument(
        data=[
            _resource(motorbike, specs.get(motorbike.id, {}), manufacturers)
            for motorbike in motorbikes
        ],
        meta=jsonapi.Meta(total_count=total),
    )


@router.get(
    "/{product_id}",
    response_model=ProductDocument,
    summary="Read a product",
    responses=jsonapi.error_responses(status.HTTP_404_NOT_FOUND),
)
async def get_product(session: SessionDep, product_id: ProductIdDep) -> ProductDocument:
    """Return one product with both of its specification revisions."""
    motorbike = await _get_or_404(session, product_id)
    return await _document(session, motorbike)


@router.post(
    "",
    response_model=ProductDocument,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(csrf_protect)],
    summary="Add a product to the backlog",
    responses=jsonapi.error_responses(status.HTTP_409_CONFLICT),
)
async def create_product(session: SessionDep, payload: ProductCreateRequest) -> ProductDocument:
    """Create an entry from a display name and start ingesting it.

    Adding a model auto-starts its ingestion: the row is created in `backlog`,
    moved to `ingesting` and its job enqueued — every step committed before the
    next — so the answer already carries the state the admin backlog shows.
    """
    try:
        motorbike = await product_service.create_backlog(session, payload.data.attributes.name)
    except product_service.DuplicateModelError as error:
        raise jsonapi.JsonApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="duplicate-model",
            detail=f"A product with slug '{error.args[0]}' already exists.",
        ) from error

    await product_service.start_ingestion(session, motorbike)
    # The status change flushed the row, expiring the server-side `updated_at`
    # (see the PATCH handler): render from a fully loaded row.
    await session.refresh(motorbike)
    return await _document(session, motorbike)


@router.patch(
    "/{product_id}",
    response_model=ProductDocument,
    dependencies=[Depends(csrf_protect)],
    summary="Update a product's status or draft specification",
    responses=jsonapi.error_responses(
        status.HTTP_404_NOT_FOUND, status.HTTP_422_UNPROCESSABLE_CONTENT
    ),
)
async def update_product(
    session: SessionDep, product_id: ProductIdDep, payload: ProductPatchRequest
) -> ProductDocument:
    """Replace the draft specification and/or move the product to a new status.

    Both attributes are optional and applied in that order, so a request that
    saves a draft and approves in one go promotes the values it just sent.
    A transition to `ingesting` is a retry: it re-enqueues the ingestion job
    server-side, so the UI only ever asks for the status it wants.
    """
    motorbike = await _get_or_404(session, product_id)
    attributes = payload.data.attributes

    if attributes.draft_spec is not None:
        await product_service.upsert_draft_spec(
            session, motorbike.id, _draft_spec_values(attributes.draft_spec)
        )

    if attributes.status is not None:
        try:
            if attributes.status is MotorbikeStatus.INGESTING:
                await product_service.start_ingestion(session, motorbike)
            else:
                await product_service.transition(session, motorbike, attributes.status)
        except product_service.InvalidTransitionError as error:
            raise jsonapi.JsonApiError(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                code="invalid-transition",
                detail=str(error),
            ) from error
        except product_service.IncompleteIdentityError as error:
            raise jsonapi.JsonApiError(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                code="incomplete-identity",
                detail=str(error),
            ) from error

    # `motorbikes.updated_at` has a server-side `onupdate`, so SQLAlchemy
    # expires the attribute when the row is flushed. Reading it back while
    # rendering would be implicit IO — fatal on an async session — hence one
    # explicit refresh, which also puts the new timestamp into the response.
    await session.refresh(motorbike)
    return await _document(session, motorbike)
