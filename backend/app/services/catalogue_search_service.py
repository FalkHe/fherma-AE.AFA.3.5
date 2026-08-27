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
* **Ids only.** The caller decides what to load about the winners (the 3.11
  tool renders a handful of columns, the retrieval leg only needs the ids), so
  this service never assembles a projection nobody asked for.

The filter shape itself lives with the translation schema
(`app.llm.query_translation.SpecFilters`) — one definition for the model's
output and the SQL's input, so a renamed bound cannot go unnoticed.
"""

from sqlalchemy import ColumnElement, Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.motorbike import Motorbike, MotorbikeStatus
from app.db.models.motorbike_spec import MotorbikeSpec, SpecKind
from app.llm.query_translation import SpecFilters


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
