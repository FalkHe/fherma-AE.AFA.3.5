"""Motorcycle brands: normalisation, get-or-create and the read companions.

This module owns its transactions and speaks no HTTP, like every service here.

One rule lives here and nowhere else: **the slug is a brand's identity.** Every
writer goes through `get_or_create`, which normalises the incoming display name,
derives the slug with the same rule `motorbikes.slug` uses and reuses the
existing row when that slug is already known — so "BMW ", "bmw" and "BMW" are
one manufacturer, whichever ingestion saw the brand first.

Nothing here announces an event: a manufacturer has no admin screen of its own
yet. The catalogue row that starts pointing at one is announced by
`product_service.assign_manufacturer`.
"""

import re
from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.manufacturer import NAME_LENGTH, Manufacturer
from app.services.product_service import slugify

_WHITESPACE_RUN = re.compile(r"\s+")


def normalize_name(raw: str | None) -> str | None:
    """Return the display form to store, or `None` when there is no name.

    Trimmed, internal whitespace collapsed to single spaces and truncated to the
    column width: `"  suzuki   motor  "` → `"suzuki motor"`. Casing is kept — the
    first writer's spelling is what the admin screens show.
    """
    if raw is None:
        return None
    collapsed = _WHITESPACE_RUN.sub(" ", raw).strip()
    return collapsed[:NAME_LENGTH] or None


async def get_or_create(session: AsyncSession, name: str) -> Manufacturer:
    """Return the manufacturer identified by `name`'s slug, creating it if new.

    The name is normalised first, so the stored display form and the derived
    slug cannot disagree. A concurrent ingestion may win the race between the
    lookup and the insert; the unique slug constraint catches that, and the row
    the other transaction committed is returned instead.

    Raises:
        ValueError: `name` normalises to nothing, or to a name without a single
            character the slug rule keeps — there is no identity to store.
    """
    display_name = normalize_name(name)
    slug = "" if display_name is None else slugify(display_name)
    if not slug:
        raise ValueError(f"Manufacturer name '{name}' has no slug characters.")

    existing = await _get_by_slug(session, slug)
    if existing is not None:
        return existing

    manufacturer = Manufacturer(name=display_name, slug=slug)
    session.add(manufacturer)
    try:
        await session.commit()
    except IntegrityError:
        # Someone else inserted the same slug between the lookup and the
        # insert: drop this transaction and take their row.
        await session.rollback()
        concurrent = await _get_by_slug(session, slug)
        if concurrent is None:
            raise
        return concurrent
    return manufacturer


async def get_by_ids(session: AsyncSession, ids: Sequence[str]) -> dict[str, Manufacturer]:
    """Return the manufacturers of several ids, keyed by id.

    One query for a whole page of the catalogue (the `get_specs` pattern): an id
    that is `None` upstream is simply not asked for, and an unknown id is absent
    from the result.
    """
    if not ids:
        return {}

    result = await session.execute(select(Manufacturer).where(Manufacturer.id.in_(list(ids))))
    return {manufacturer.id: manufacturer for manufacturer in result.scalars().all()}


async def list_manufacturers(
    session: AsyncSession, *, limit: int, offset: int
) -> tuple[list[Manufacturer], int]:
    """Return one page of manufacturers by name plus the unpaginated total.

    Alphabetical, not newest-first like the catalogue: this is a reference list.
    Paging is stable without a tiebreaker — two rows cannot carry the same name,
    because equal names derive the same (unique) slug.
    """
    total = await session.execute(select(func.count()).select_from(Manufacturer))
    page = await session.execute(
        select(Manufacturer).order_by(Manufacturer.name).limit(limit).offset(offset)
    )
    return list(page.scalars().all()), total.scalar_one()


async def _get_by_slug(session: AsyncSession, slug: str) -> Manufacturer | None:
    result = await session.execute(select(Manufacturer).where(Manufacturer.slug == slug))
    return result.scalar_one_or_none()
