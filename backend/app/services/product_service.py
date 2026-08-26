"""Catalogue entries: creation, the status workflow and specification writes.

This module owns its transactions and speaks no HTTP: callers translate the
exceptions raised here into status codes or exit codes.

Two rules are enforced here and nowhere else:

* the **legal transition matrix** — every status change goes through
  `transition`, so an illegal one is impossible regardless of caller;
* **`verified` specifications are only ever promotions of a draft.** Approval
  copies the draft row and flips pending images in the same transaction, so a
  model can never be publicly visible with a half-applied review.
"""

import re
from collections.abc import Mapping
from decimal import Decimal
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.motorbike import Motorbike, MotorbikeStatus
from app.db.models.motorbike_image import ImageStatus, MotorbikeImage
from app.db.models.motorbike_spec import SPEC_FIELDS, MotorbikeSpec, SpecKind

# Which status may follow which. Anything absent from this map is rejected —
# including a no-op change to the current status.
LEGAL_TRANSITIONS: dict[MotorbikeStatus, frozenset[MotorbikeStatus]] = {
    # Admin add auto-starts ingestion; retry/start.
    MotorbikeStatus.BACKLOG: frozenset({MotorbikeStatus.INGESTING}),
    # Job success / job failure.
    MotorbikeStatus.INGESTING: frozenset({MotorbikeStatus.IN_REVIEW, MotorbikeStatus.BACKLOG}),
    MotorbikeStatus.IN_REVIEW: frozenset({MotorbikeStatus.APPROVED, MotorbikeStatus.REJECTED}),
    MotorbikeStatus.APPROVED: frozenset(),
    # `rejected` is not terminal: re-queueing means a fresh ingestion. The row
    # keeps its draft specification, documents and images either way.
    MotorbikeStatus.REJECTED: frozenset({MotorbikeStatus.INGESTING}),
}

# A2 driving licence limits: at most 35 kW and at most 0.2 kW per kg.
A2_MAX_POWER_KW = Decimal("35")
A2_MAX_POWER_TO_WEIGHT = Decimal("0.2")

_NON_SLUG_CHARACTERS = re.compile(r"[^a-z0-9]+")


class DuplicateModelError(Exception):
    """Raised when a new catalogue entry collides with an existing slug."""


class InvalidTransitionError(Exception):
    """Raised when a requested status change is not in the transition matrix."""

    def __init__(self, current: MotorbikeStatus, requested: MotorbikeStatus) -> None:
        super().__init__(f"Cannot change status from '{current.value}' to '{requested.value}'.")
        self.current = current
        self.requested = requested


def slugify(name: str) -> str:
    """Return the unique identity derived from a display name.

    Lowercase, every run of non-alphanumeric characters collapsed to a single
    hyphen, hyphens trimmed off both ends: `" Suzuki GSR 600 "` →
    `"suzuki-gsr-600"`.
    """
    return _NON_SLUG_CHARACTERS.sub("-", name.lower()).strip("-")


async def create_backlog(session: AsyncSession, name: str) -> Motorbike:
    """Create a `backlog` entry for `name` and return it.

    Raises:
        DuplicateModelError: the derived slug is already in the catalogue.
    """
    slug = slugify(name)
    if await _get_by_slug(session, slug) is not None:
        raise DuplicateModelError(slug)

    motorbike = Motorbike(name=name.strip(), slug=slug, status=MotorbikeStatus.BACKLOG)
    session.add(motorbike)
    await session.commit()
    return motorbike


async def transition(
    session: AsyncSession, motorbike: Motorbike, new_status: MotorbikeStatus
) -> Motorbike:
    """Move `motorbike` to `new_status`, applying that status's side effects.

    Approval is the only status carrying side effects, and they land in the same
    transaction as the status change: the draft specification is promoted to a
    `verified` row and every `pending` image becomes `approved`.

    Raises:
        InvalidTransitionError: the change is not in `LEGAL_TRANSITIONS`.
    """
    if new_status not in LEGAL_TRANSITIONS[motorbike.status]:
        raise InvalidTransitionError(motorbike.status, new_status)

    motorbike.status = new_status
    if new_status is MotorbikeStatus.APPROVED:
        await _apply_approval(session, motorbike.id)
    await session.commit()
    return motorbike


async def upsert_draft_spec(
    session: AsyncSession, motorbike_id: str, values: Mapping[str, Any]
) -> MotorbikeSpec:
    """Replace the draft specification of `motorbike_id` and return the row.

    Full-object semantics: every field of the frozen column set that `values`
    omits is reset (to NULL, or `{}` for `extra`), and a missing draft row is
    created. `a2_eligible` is derived when the incoming value is NULL.

    Raises:
        ValueError: `values` contains a key outside the frozen column set.
    """
    spec = await _upsert_spec(session, motorbike_id, SpecKind.DRAFT, values)
    await session.commit()
    return spec


async def _apply_approval(session: AsyncSession, motorbike_id: str) -> None:
    """Promote the draft specification and approve pending images.

    Deliberately does **not** commit: `transition` owns the transaction so the
    status change and these side effects cannot come apart.
    """
    draft = await _get_spec(session, motorbike_id, SpecKind.DRAFT)
    if draft is not None:
        await _upsert_spec(session, motorbike_id, SpecKind.VERIFIED, _spec_values(draft))

    await session.execute(
        update(MotorbikeImage)
        .where(
            MotorbikeImage.motorbike_id == motorbike_id,
            MotorbikeImage.status == ImageStatus.PENDING,
        )
        .values(status=ImageStatus.APPROVED)
    )


async def _upsert_spec(
    session: AsyncSession, motorbike_id: str, kind: SpecKind, values: Mapping[str, Any]
) -> MotorbikeSpec:
    """Write `values` onto the (motorbike, kind) row **without committing**."""
    normalized = _normalize_spec_values(values)
    spec = await _get_spec(session, motorbike_id, kind)
    if spec is None:
        spec = MotorbikeSpec(motorbike_id=motorbike_id, kind=kind)
        session.add(spec)
    for field, value in normalized.items():
        setattr(spec, field, value)
    return spec


def _normalize_spec_values(values: Mapping[str, Any]) -> dict[str, Any]:
    """Return the full frozen column set, defaults applied, `a2_eligible` resolved."""
    unknown = sorted(set(values) - set(SPEC_FIELDS))
    if unknown:
        raise ValueError(f"Unknown specification fields: {', '.join(unknown)}.")

    normalized = {field: values.get(field) for field in SPEC_FIELDS}
    # The column is NOT NULL; an omitted long tail is an empty one.
    normalized["extra"] = normalized["extra"] or {}
    normalized["a2_eligible"] = _resolve_a2_eligible(normalized)
    return normalized


def _resolve_a2_eligible(values: Mapping[str, Any]) -> bool | None:
    """Return the `a2_eligible` value to store.

    An explicit (admin-set) value always wins. Otherwise the A2 limits are
    applied when both inputs are known, and NULL stands for "cannot tell".
    """
    incoming = values.get("a2_eligible")
    if incoming is not None:
        return bool(incoming)

    power_kw = values.get("power_kw")
    wet_weight_kg = values.get("wet_weight_kg")
    if power_kw is None or wet_weight_kg is None:
        return None

    power = Decimal(str(power_kw))
    weight = Decimal(str(wet_weight_kg))
    if weight <= 0:
        # Not a weight; deriving from it would be arithmetic, not information.
        return None
    return power <= A2_MAX_POWER_KW and power / weight <= A2_MAX_POWER_TO_WEIGHT


def _spec_values(spec: MotorbikeSpec) -> dict[str, Any]:
    return {field: getattr(spec, field) for field in SPEC_FIELDS}


async def _get_by_slug(session: AsyncSession, slug: str) -> Motorbike | None:
    result = await session.execute(select(Motorbike).where(Motorbike.slug == slug))
    return result.scalar_one_or_none()


async def _get_spec(
    session: AsyncSession, motorbike_id: str, kind: SpecKind
) -> MotorbikeSpec | None:
    result = await session.execute(
        select(MotorbikeSpec).where(
            MotorbikeSpec.motorbike_id == motorbike_id, MotorbikeSpec.kind == kind
        )
    )
    return result.scalar_one_or_none()
