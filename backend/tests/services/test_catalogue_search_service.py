"""`app/services/catalogue_search_service.py` — the shortlist SQL (step 3.8).

The statement joins two tables and is executed by PostgreSQL, which no test here
connects to (see `tests/conftest.py`), and the service-level `FakeAsyncSession`
interprets single-entity selects only — so the convention established in
`test_retrieval_service.py` applies: a `RecordingSession` replays scripted rows
and the **compiled** SQL is what is asserted.

What matters about this service is entirely in that statement:

* the two non-negotiable conditions (`approved` entry, `verified` revision);
* one clause per stated bound, on the right column, with the value bound rather
  than inlined;
* no clause at all for a bound the customer did not state — and, crucially, no
  Python-side post-filtering that would let an unverified value decide a match.
"""

import asyncio
import re
from typing import Any

import pytest
from sqlalchemy.dialects import postgresql

from app.db.models.motorbike import MotorbikeStatus
from app.db.models.motorbike_spec import SpecKind
from app.llm.query_translation import FILTER_FIELD_COLUMNS, SpecFilters
from app.services import catalogue_search_service

BIKE_ID = "01J0BIKE00000000000000000A"
OTHER_BIKE_ID = "01J0BIKE00000000000000000B"

# `%(name)s` placeholders make an assertion depend on SQLAlchemy's parameter
# numbering; the shape of the statement is what matters here.
_PARAMETER = re.compile(r"%\([a-z_0-9]+\)s")

# One plausible answer per field of `SpecFilters`, so the coverage test below can
# drive every bound. Asserted to be complete: a new bound without a sample here
# fails instead of going untested.
SAMPLES: dict[str, Any] = {
    "categories": ["naked", "scrambler"],
    "engine_cc_min": 400,
    "engine_cc_max": 800,
    "power_kw_min": 20.0,
    "power_kw_max": 35.0,
    "wet_weight_kg_max": 200.0,
    "seat_height_mm_max": 800,
    "a2_eligible": True,
    "price_bands": ["budget", "mid"],
}


class _Scalars:
    def __init__(self, rows: list[str]) -> None:
        self._rows = rows

    def all(self) -> list[str]:
        return self._rows


class _Result:
    def __init__(self, rows: list[str]) -> None:
        self._rows = rows

    def scalars(self) -> _Scalars:
        return _Scalars(self._rows)


class RecordingSession:
    """Stands in for `AsyncSession`: records statements, replays scripted ids."""

    def __init__(self, rows: list[str] | None = None) -> None:
        self.rows = rows if rows is not None else []
        self.statements: list[Any] = []

    async def execute(self, statement: Any) -> _Result:
        self.statements.append(statement)
        return _Result(self.rows)


def _find(session: RecordingSession, filters: SpecFilters | None = None) -> list[str]:
    """Drive the async service from a synchronous test."""
    return asyncio.run(
        catalogue_search_service.find_motorbike_ids(session, filters or SpecFilters())
    )


def _compiled(session: RecordingSession) -> Any:
    """Compile the single statement the service issued, for PostgreSQL."""
    assert len(session.statements) == 1, "a shortlist must be one round trip"
    return session.statements[0].compile(dialect=postgresql.dialect())


def _sql(session: RecordingSession) -> str:
    """Return the compiled SQL with bound parameters reduced to `?`."""
    return _PARAMETER.sub("?", str(_compiled(session)))


def test_returns_the_ids_the_database_returned_in_its_order() -> None:
    """The service maps, it does not sort or filter."""
    session = RecordingSession([BIKE_ID, OTHER_BIKE_ID])

    assert _find(session) == [BIKE_ID, OTHER_BIKE_ID]


def test_only_verified_specs_of_approved_models_are_searched() -> None:
    """The two conditions that make a number showable, both in SQL."""
    session = RecordingSession()

    _find(session)
    sql = _sql(session)
    params = _compiled(session).params

    assert "JOIN motorbike_specs ON motorbike_specs.motorbike_id = motorbikes.id" in sql
    assert "motorbikes.status = ?" in sql
    assert "motorbike_specs.kind = ?" in sql
    assert params["status_1"] is MotorbikeStatus.APPROVED
    assert params["kind_1"] is SpecKind.VERIFIED
    # A stable order the caller can cut without re-sorting.
    assert "ORDER BY motorbikes.name, motorbikes.id" in sql


def test_an_empty_filter_set_narrows_nothing() -> None:
    """No stated bound, no clause — the whole approved candidate space."""
    session = RecordingSession()

    _find(session)
    sql = _sql(session)

    for column in set(FILTER_FIELD_COLUMNS.values()):
        assert f"motorbike_specs.{column} " not in sql


def test_every_sample_covers_a_field_of_the_filter_schema() -> None:
    """The coverage test below is only as complete as this table."""
    assert set(SAMPLES) == set(SpecFilters.model_fields)


@pytest.mark.parametrize("field", sorted(SAMPLES))
def test_every_stated_bound_becomes_a_clause_on_its_column(field: str) -> None:
    """One bound in, one clause on the frozen column it constrains."""
    session = RecordingSession()

    _find(session, SpecFilters.model_validate({field: SAMPLES[field]}))
    sql = _sql(session)

    column = f"motorbike_specs.{FILTER_FIELD_COLUMNS[field]}"
    assert column in sql
    # Every other filterable column stays out of the statement.
    for other in set(FILTER_FIELD_COLUMNS.values()) - {FILTER_FIELD_COLUMNS[field]}:
        assert f"motorbike_specs.{other} " not in sql


def test_the_bounds_are_the_expected_comparisons() -> None:
    """Minima are `>=`, maxima are `<=`, vocabularies are `IN`, A2 is `IS`."""
    session = RecordingSession()

    _find(session, SpecFilters.model_validate(SAMPLES))
    sql = _sql(session)
    params = _compiled(session).params

    assert "motorbike_specs.engine_cc >= ?" in sql
    assert "motorbike_specs.engine_cc <= ?" in sql
    assert "motorbike_specs.power_kw >= ?" in sql
    assert "motorbike_specs.power_kw <= ?" in sql
    assert "motorbike_specs.wet_weight_kg <= ?" in sql
    assert "motorbike_specs.seat_height_mm <= ?" in sql
    # `IS true`, so a bike whose eligibility is unknown never passes.
    assert "motorbike_specs.a2_eligible IS true" in sql
    assert "motorbike_specs.category IN (__[POSTCOMPILE_category_1])" in sql
    assert "motorbike_specs.price_band IN (__[POSTCOMPILE_price_band_1])" in sql
    # Enum members are unwrapped: the columns are `String`, not enums.
    assert params["category_1"] == ["naked", "scrambler"]
    assert params["price_band_1"] == ["budget", "mid"]
    assert params["seat_height_mm_1"] == 800


def test_a2_eligible_false_is_a_clause_too() -> None:
    """`False` is a stated bound, not "unstated" — and `NULL` still never passes."""
    session = RecordingSession()

    _find(session, SpecFilters(a2_eligible=False))

    assert "motorbike_specs.a2_eligible IS false" in _sql(session)
