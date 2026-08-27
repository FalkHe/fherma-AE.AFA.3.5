"""Structured catalogue search: typed spec filters in, motorbike ids out.

This is the structured half of the advanced-RAG pair. `retrieval_service`
answers "what does the prose say?"; this service answers "which bikes can
actually satisfy the stated constraints?" — and it answers it from the
`verified` specification revision of `approved` catalogue entries only, because
those are the only numbers the project is willing to show a customer.

Three rules live here:

* **Verified specs of approved models, always.** A `draft` revision is an
  extraction an admin has not signed off, so filtering on it would let an
  unreviewed number decide a recommendation. Both conditions are `WHERE`
  clauses, never a post-filter.
* **A missing value never matches.** A filter is a claim ("the seat must be at
  most 800 mm"), and a bike whose verified seat height is `NULL` cannot support
  that claim. SQL's three-valued logic drops those rows, which is exactly the
  intent: the project shows verified specs or nothing, and it never guesses one
  to keep a bike in the list.
* **Ids only.** `find_motorbike_ids` decides nothing about the projection: the
  caller says what it needs about the winners, and `get_verified_specs` is that
  second, explicit step (the retrieval leg never asks for it).

Two more entry points serve the step-3.11 agent tools, and they keep the same
three rules:

* `resolve_name` — the shared name→bike resolution every tool needs (a customer
  writes "CB500F", not a ULID): exact slug first, then a substring match,
  approved entries only, `None` rather than an exception when nothing matches.
* `get_verified_specs` — display values for a set of ids: the frozen
  specification columns of the `verified` revision, every field present, `None`
  where the catalogue has no verified number. Nothing is ever inferred to fill a
  gap; the comparison table shows the gap instead.

The filter shape itself lives with the translation schema
(`app.llm.query_translation.SpecFilters`) — one definition for the model's
output and the SQL's input, so a renamed bound cannot go unnoticed.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from sqlalchemy import ColumnElement, Select, and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.motorbike import Motorbike, MotorbikeStatus
from app.db.models.motorbike_spec import MotorbikeSpec, SpecKind
from app.llm.query_translation import SpecFilters
from app.services import product_service

# Which frozen specification columns a comparison shows, in table order, and
# which it deliberately leaves out. Together they are exactly `SPEC_FIELDS` —
# the drift guard in `tests/services/test_catalogue_search_service.py` asserts
# that, so a new column forces a decision here instead of quietly never being
# comparable (the same guard 3.8 put on the filterable set).
COMPARISON_SPEC_FIELDS: tuple[str, ...] = (
    "category",
    "engine_cc",
    "cylinders",
    "power_kw",
    "torque_nm",
    "wet_weight_kg",
    "seat_height_mm",
    "tank_capacity_l",
    "top_speed_kmh",
    "abs",
    "a2_eligible",
    "price_band",
    "msrp_eur",
)
# `extra` and `source_hints` are a free-form long tail and per-field extraction
# provenance — internal bookkeeping, not a row a customer compares two bikes on
# (and neither is a scalar a table cell could hold); `extracted_at` says when an
# extraction ran, which is a curation fact, not a specification.
UNCOMPARED_SPEC_FIELDS: tuple[str, ...] = ("extra", "source_hints", "extracted_at")


@dataclass(frozen=True, slots=True)
class VerifiedSpecs:
    """One approved catalogue entry with its verified specification values.

    `values` carries **every** `COMPARISON_SPEC_FIELDS` key (snake_case, as the
    columns are named — camelCase aliasing is the tool's job), and a key whose
    verified value is missing is present with `None`. Values are plain
    JSON-serializable Python (`Decimal` unwrapped to `float`), because they end
    up in a tool result and then in a JSONB column.
    """

    motorbike_id: str
    name: str
    values: dict[str, Any]


async def find_motorbike_ids(session: AsyncSession, filters: SpecFilters) -> list[str]:
    """Return the ids of approved motorbikes whose verified specs match `filters`.

    Args:
        session: Session the single statement runs on; nothing is written, so
            no transaction is committed here.
        filters: The translated constraints. An empty filter set is not an
            error — it matches every approved motorbike that has a verified
            specification, which is the whole candidate space.

    Returns:
        Motorbike ids ordered by name (then id, so equally named entries keep a
        stable order). Ordering is the database's; the caller may cut the list
        but never has to re-sort it.
    """
    result = await session.execute(_build_statement(filters))
    return list(result.scalars().all())


async def resolve_name(session: AsyncSession, name: str) -> Motorbike | None:
    """Resolve a written model name to an approved catalogue entry.

    Two steps, most precise first:

    1. the **exact slug** derived from the name (`" Suzuki  GSR 600 "` →
       `suzuki-gsr-600`), which already absorbs case, spacing and punctuation;
    2. a **substring match** on the display name (`ILIKE '%…%'`), which catches
       the partial names a conversation uses ("CB500F" → "Honda CB500F"). The
       shortest matching name wins, then the name, then the id — the shortest is
       the closest to what was asked for, and the tiebreakers make the answer
       deterministic rather than dependent on the plan.

    Substring rather than trigram similarity on purpose: `pg_trgm` is not
    installed in this schema and only step 3.1 may carry a migration this phase.
    The two steps are the pinned resolution order either way, so adding the
    extension later changes step 2 alone.

    Args:
        session: Session the lookups run on; nothing is written or committed.
        name: The model name as it was written. Blank resolves to `None`.

    Returns:
        The approved entry, or `None` when the catalogue has nothing under that
        name (or has it, but not approved — an unreviewed entry is not something
        a customer may be shown). **Never raises for an unknown name**: callers
        turn `None` into the pinned `{"unknownBike": …}` tool result or skip it.
    """
    text = " ".join(name.split())
    if not text:
        return None

    slug = product_service.slugify(text)
    if slug:
        motorbike = await product_service.get_by_slug(session, slug)
        if motorbike is not None and motorbike.status is MotorbikeStatus.APPROVED:
            return motorbike

    result = await session.execute(_name_match_statement(text))
    return result.scalars().first()


async def get_verified_specs(
    session: AsyncSession, motorbike_ids: Sequence[str]
) -> list[VerifiedSpecs]:
    """Return the verified specification values of approved entries, in the given order.

    One statement, one `LEFT OUTER JOIN`: an approved entry *without* a verified
    revision still comes back — with every value `None`, which is the honest
    answer a comparison column must be able to show. An id that is unknown or
    not approved is simply absent from the result, so the caller can tell the
    two apart by length or by id.

    Args:
        session: Session the statement runs on; nothing is written or committed.
        motorbike_ids: The ids to load, in the order the answer should keep
            (`find_motorbike_ids` already returns them name-ordered, and a
            comparison keeps the order the customer named the bikes in). Empty
            returns `[]` without a round trip.
    """
    if not motorbike_ids:
        return []

    result = await session.execute(_specs_statement(motorbike_ids))
    found = {row["id"]: row for row in result.mappings().all()}
    # Re-ordering in Python is alignment, not sorting: the caller's order is the
    # contract (comparison columns are aligned to it), and it cannot be
    # expressed as an `ORDER BY` over a set of ids.
    return [
        VerifiedSpecs(
            motorbike_id=motorbike_id,
            name=found[motorbike_id]["name"],
            values={field: _plain(found[motorbike_id][field]) for field in COMPARISON_SPEC_FIELDS},
        )
        for motorbike_id in motorbike_ids
        if motorbike_id in found
    ]


def _build_statement(filters: SpecFilters) -> Select[tuple[str]]:
    """Compose the one candidate-shortlist statement.

    Split out from `find_motorbike_ids` so the SQL can be read (and compiled in
    a test) without a database round trip.
    """
    return (
        select(Motorbike.id)
        # Inner join: a bike without a verified specification has nothing to
        # filter on and is therefore not a candidate, filters or no filters.
        .join(MotorbikeSpec, MotorbikeSpec.motorbike_id == Motorbike.id)
        .where(
            Motorbike.status == MotorbikeStatus.APPROVED,
            MotorbikeSpec.kind == SpecKind.VERIFIED,
            *_clauses(filters),
        )
        .order_by(Motorbike.name, Motorbike.id)
    )


def _clauses(filters: SpecFilters) -> list[ColumnElement[bool]]:
    """Return one SQL clause per stated bound, in `FILTER_FIELD_COLUMNS` order.

    Every field of `SpecFilters` is represented here; the test suite asserts
    that, so a new bound cannot be added to the schema and then quietly ignored
    by the search.
    """
    clauses: list[ColumnElement[bool]] = []
    if filters.categories:
        clauses.append(MotorbikeSpec.category.in_([item.value for item in filters.categories]))
    if filters.engine_cc_min is not None:
        clauses.append(MotorbikeSpec.engine_cc >= filters.engine_cc_min)
    if filters.engine_cc_max is not None:
        clauses.append(MotorbikeSpec.engine_cc <= filters.engine_cc_max)
    if filters.power_kw_min is not None:
        clauses.append(MotorbikeSpec.power_kw >= filters.power_kw_min)
    if filters.power_kw_max is not None:
        clauses.append(MotorbikeSpec.power_kw <= filters.power_kw_max)
    if filters.wet_weight_kg_max is not None:
        clauses.append(MotorbikeSpec.wet_weight_kg <= filters.wet_weight_kg_max)
    if filters.seat_height_mm_max is not None:
        clauses.append(MotorbikeSpec.seat_height_mm <= filters.seat_height_mm_max)
    if filters.a2_eligible is not None:
        # `IS true` / `IS false` rather than `=`: it reads as the three-valued
        # test it is, and an unknown eligibility never passes for either value.
        clauses.append(MotorbikeSpec.a2_eligible.is_(filters.a2_eligible))
    if filters.price_bands:
        clauses.append(MotorbikeSpec.price_band.in_([item.value for item in filters.price_bands]))
    return clauses


def _name_match_statement(text: str) -> Select[tuple[Motorbike]]:
    """Compose the substring fallback of `resolve_name` (step 2 of the two)."""
    return (
        select(Motorbike)
        .where(
            Motorbike.status == MotorbikeStatus.APPROVED,
            Motorbike.name.ilike(f"%{_escaped(text)}%", escape="\\"),
        )
        # Shortest name first: "CB500F" should answer with the CB500F, not with a
        # longer entry that happens to contain it.
        .order_by(func.length(Motorbike.name), Motorbike.name, Motorbike.id)
        .limit(1)
    )


def _escaped(text: str) -> str:
    """Neutralize the `LIKE` wildcards in text a customer wrote.

    `%` and `_` in a name would otherwise widen the pattern (a lone `%` matching
    every approved entry), which is a wrong answer, not a syntax error — so the
    input is escaped here rather than validated away.
    """
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _specs_statement(motorbike_ids: Sequence[str]) -> Select[Any]:
    """Compose the one display-values statement `get_verified_specs` issues.

    The `verified` condition sits in the `ON` clause, not in the `WHERE`: on the
    outer side of the join it would drop the very rows this projection is meant
    to keep (an approved entry whose specification was never verified).
    """
    columns = [getattr(MotorbikeSpec, field) for field in COMPARISON_SPEC_FIELDS]
    return (
        select(Motorbike.id, Motorbike.name, *columns)
        .outerjoin(
            MotorbikeSpec,
            and_(
                MotorbikeSpec.motorbike_id == Motorbike.id,
                MotorbikeSpec.kind == SpecKind.VERIFIED,
            ),
        )
        .where(
            Motorbike.id.in_(list(motorbike_ids)),
            Motorbike.status == MotorbikeStatus.APPROVED,
        )
    )


def _plain(value: Any) -> Any:
    """Return a specification value as plain JSON-serializable Python.

    Only `Decimal` needs unwrapping (`Numeric` columns): the value travels into a
    tool result and from there into a JSONB column, and `json.dumps` cannot
    encode a `Decimal`. `None` stays `None` — a missing verified number is never
    replaced by a zero or a guess.
    """
    return float(value) if isinstance(value, Decimal) else value
