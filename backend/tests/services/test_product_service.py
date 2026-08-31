"""`app/services/product_service.py` — slugs, the transition matrix, spec writes.

Uses the in-memory `FakeAsyncSession` from `tests/services/conftest.py`; every
async service call is driven through `asyncio.run()` per the project's
"no pytest-asyncio" convention.
"""

import asyncio
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy.dialects import postgresql

from app.db.models.motorbike import Motorbike, MotorbikeStatus
from app.db.models.motorbike_image import ImageStatus, MotorbikeImage
from app.db.models.motorbike_spec import MotorbikeSpec, SpecKind
from app.services import product_service
from app.services.product_service import (
    LEGAL_TRANSITIONS,
    DuplicateModelError,
    InvalidTransitionError,
)
from tests.services.conftest import FakeAsyncSession

LEGAL_PAIRS = [
    (current, requested)
    for current, allowed in LEGAL_TRANSITIONS.items()
    for requested in sorted(allowed)
]
ILLEGAL_PAIRS = [
    (current, requested)
    for current in MotorbikeStatus
    for requested in MotorbikeStatus
    if (current, requested) not in LEGAL_PAIRS
]


def _backlog(session: FakeAsyncSession, name: str = "Suzuki GSR 600") -> Motorbike:
    return asyncio.run(product_service.create_backlog(session, name))


def _in_status(
    session: FakeAsyncSession, status: MotorbikeStatus, name: str = "Suzuki GSR 600"
) -> Motorbike:
    """Return a stored motorbike parked in `status`, bypassing the matrix."""
    motorbike = _backlog(session, name)
    motorbike.status = status
    return motorbike


def _spec_of(session: FakeAsyncSession, motorbike_id: str, kind: SpecKind) -> MotorbikeSpec | None:
    matches = [
        spec
        for spec in session.rows(MotorbikeSpec)
        if spec.motorbike_id == motorbike_id and spec.kind is kind
    ]
    assert len(matches) <= 1, "more than one spec row per (motorbike, kind)"
    return matches[0] if matches else None


def _image(session: FakeAsyncSession, motorbike_id: str, status: ImageStatus) -> MotorbikeImage:
    image = MotorbikeImage(
        motorbike_id=motorbike_id,
        source_url="https://example.invalid/bike.jpg",
        original_path=f"motorbikes/{motorbike_id}/original.jpg",
        status=status,
    )
    session.add(image)
    return image


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Suzuki GSR 600", "suzuki-gsr-600"),
        ("  Suzuki   GSR 600  ", "suzuki-gsr-600"),
        ("BMW R1250GS Adventure", "bmw-r1250gs-adventure"),
        ("Ducati Multistrada V4 (2022)", "ducati-multistrada-v4-2022"),
        ("KTM 390 Duke!!!", "ktm-390-duke"),
    ],
)
def test_slugify_pinned_rule(name: str, expected: str) -> None:
    assert product_service.slugify(name) == expected


def test_create_backlog_stores_slug_and_backlog_status(fake_session: FakeAsyncSession) -> None:
    motorbike = _backlog(fake_session, "  Suzuki GSR 600 ")

    assert motorbike.query_name == "Suzuki GSR 600"
    assert motorbike.slug == "suzuki-gsr-600"
    assert motorbike.status is MotorbikeStatus.BACKLOG
    assert motorbike.id is not None
    # One commit for the row, one for the `product.updated` announcement that
    # follows it (`operation_service.notify` commits its own `pg_notify`).
    assert fake_session.commit_count == 2


def test_create_backlog_duplicate_slug_raises(fake_session: FakeAsyncSession) -> None:
    _backlog(fake_session, "Suzuki GSR 600")

    with pytest.raises(DuplicateModelError):
        _backlog(fake_session, "suzuki gsr-600")


@pytest.mark.parametrize(("current", "requested"), LEGAL_PAIRS)
def test_transition_allows_every_legal_pair(
    fake_session: FakeAsyncSession, current: MotorbikeStatus, requested: MotorbikeStatus
) -> None:
    motorbike = _in_status(fake_session, current)

    updated = asyncio.run(product_service.transition(fake_session, motorbike, requested))

    assert updated.status is requested


@pytest.mark.parametrize(("current", "requested"), ILLEGAL_PAIRS)
def test_transition_rejects_every_illegal_pair(
    fake_session: FakeAsyncSession, current: MotorbikeStatus, requested: MotorbikeStatus
) -> None:
    motorbike = _in_status(fake_session, current)
    commits_before = fake_session.commit_count

    with pytest.raises(InvalidTransitionError) as raised:
        asyncio.run(product_service.transition(fake_session, motorbike, requested))

    assert raised.value.current is current
    assert raised.value.requested is requested
    assert motorbike.status is current
    assert fake_session.commit_count == commits_before


def test_approval_promotes_draft_and_flips_pending_images_in_one_commit(
    fake_session: FakeAsyncSession,
) -> None:
    motorbike = _in_status(fake_session, MotorbikeStatus.IN_REVIEW)
    asyncio.run(
        product_service.upsert_draft_spec(
            fake_session,
            motorbike.id,
            {
                "category": "naked",
                "engine_cc": 599,
                "power_kw": Decimal("58.0"),
                "wet_weight_kg": Decimal("214.0"),
                "extra": {"frame": "aluminium"},
            },
        )
    )
    pending = _image(fake_session, motorbike.id, ImageStatus.PENDING)
    already_rejected = _image(fake_session, motorbike.id, ImageStatus.REJECTED)
    other_bike = _in_status(fake_session, MotorbikeStatus.IN_REVIEW, "Honda CB 500 F")
    other_pending = _image(fake_session, other_bike.id, ImageStatus.PENDING)
    commits_before = fake_session.commit_count

    asyncio.run(product_service.transition(fake_session, motorbike, MotorbikeStatus.APPROVED))

    verified = _spec_of(fake_session, motorbike.id, SpecKind.VERIFIED)
    assert verified is not None
    assert verified.category == "naked"
    assert verified.engine_cc == 599
    assert verified.extra == {"frame": "aluminium"}
    # The draft is kept, not moved.
    assert _spec_of(fake_session, motorbike.id, SpecKind.DRAFT) is not None
    assert pending.status is ImageStatus.APPROVED
    assert already_rejected.status is ImageStatus.REJECTED
    assert other_pending.status is ImageStatus.PENDING
    # Status change, promotion and image flip share a single transaction; the
    # second commit is the `product.updated` announcement, which by contract
    # only ever follows a committed change.
    assert fake_session.commit_count == commits_before + 2


def test_approval_without_draft_spec_writes_no_verified_row(
    fake_session: FakeAsyncSession,
) -> None:
    motorbike = _in_status(fake_session, MotorbikeStatus.IN_REVIEW)
    pending = _image(fake_session, motorbike.id, ImageStatus.PENDING)

    asyncio.run(product_service.transition(fake_session, motorbike, MotorbikeStatus.APPROVED))

    assert _spec_of(fake_session, motorbike.id, SpecKind.VERIFIED) is None
    assert pending.status is ImageStatus.APPROVED


def test_approval_replaces_a_previous_verified_row(fake_session: FakeAsyncSession) -> None:
    motorbike = _in_status(fake_session, MotorbikeStatus.IN_REVIEW)
    asyncio.run(product_service.upsert_draft_spec(fake_session, motorbike.id, {"engine_cc": 599}))
    asyncio.run(product_service.transition(fake_session, motorbike, MotorbikeStatus.APPROVED))
    first = _spec_of(fake_session, motorbike.id, SpecKind.VERIFIED)

    motorbike.status = MotorbikeStatus.IN_REVIEW
    asyncio.run(product_service.upsert_draft_spec(fake_session, motorbike.id, {"engine_cc": 649}))
    asyncio.run(product_service.transition(fake_session, motorbike, MotorbikeStatus.APPROVED))

    second = _spec_of(fake_session, motorbike.id, SpecKind.VERIFIED)
    assert second is first
    assert second is not None
    assert second.engine_cc == 649


def test_rejection_retains_draft_spec_and_images(fake_session: FakeAsyncSession) -> None:
    motorbike = _in_status(fake_session, MotorbikeStatus.IN_REVIEW)
    asyncio.run(product_service.upsert_draft_spec(fake_session, motorbike.id, {"engine_cc": 599}))
    pending = _image(fake_session, motorbike.id, ImageStatus.PENDING)

    asyncio.run(product_service.transition(fake_session, motorbike, MotorbikeStatus.REJECTED))

    assert motorbike.status is MotorbikeStatus.REJECTED
    assert _spec_of(fake_session, motorbike.id, SpecKind.DRAFT) is not None
    assert _spec_of(fake_session, motorbike.id, SpecKind.VERIFIED) is None
    assert pending.status is ImageStatus.PENDING
    # Not terminal: an admin re-queues a fresh ingestion.
    assert asyncio.run(
        product_service.transition(fake_session, motorbike, MotorbikeStatus.INGESTING)
    )


def test_upsert_draft_spec_creates_then_replaces_full_object(
    fake_session: FakeAsyncSession,
) -> None:
    motorbike = _backlog(fake_session)
    extracted_at = datetime(2026, 8, 26, 12, 0, tzinfo=UTC)

    created = asyncio.run(
        product_service.upsert_draft_spec(
            fake_session,
            motorbike.id,
            {
                "category": "naked",
                "engine_cc": 599,
                "seat_height_mm": 785,
                "abs": True,
                "source_hints": {"engine_cc": "wikipedia"},
                "extracted_at": extracted_at,
            },
        )
    )

    assert created.kind is SpecKind.DRAFT
    assert created.engine_cc == 599
    assert created.extra == {}
    assert created.extracted_at == extracted_at

    replaced = asyncio.run(
        product_service.upsert_draft_spec(fake_session, motorbike.id, {"engine_cc": 649})
    )

    # Same row, and every omitted field is reset — writes are full-object.
    assert replaced is created
    assert replaced.engine_cc == 649
    assert replaced.category is None
    assert replaced.seat_height_mm is None
    assert replaced.abs is None
    assert replaced.source_hints is None
    assert replaced.extracted_at is None
    assert replaced.extra == {}


def test_upsert_draft_spec_rejects_unknown_field(fake_session: FakeAsyncSession) -> None:
    motorbike = _backlog(fake_session)

    with pytest.raises(ValueError, match="horsepower"):
        asyncio.run(
            product_service.upsert_draft_spec(fake_session, motorbike.id, {"horsepower": 80})
        )


@pytest.mark.parametrize(
    ("values", "expected"),
    [
        # Both limits exactly met: 35.0 kW and 35.0/175.0 == 0.2 exactly.
        ({"power_kw": Decimal("35.0"), "wet_weight_kg": Decimal("175.0")}, True),
        # One step over the power limit.
        ({"power_kw": Decimal("35.1"), "wet_weight_kg": Decimal("400.0")}, False),
        # Power within limits, ratio just over 0.2.
        ({"power_kw": Decimal("35.0"), "wet_weight_kg": Decimal("174.9")}, False),
        ({"power_kw": Decimal("25.0"), "wet_weight_kg": Decimal("170.0")}, True),
        # Not derivable: one input unknown.
        ({"power_kw": Decimal("35.0")}, None),
        ({"wet_weight_kg": Decimal("175.0")}, None),
        ({}, None),
        # An explicit value always wins over the formula.
        (
            {"power_kw": Decimal("35.0"), "wet_weight_kg": Decimal("175.0"), "a2_eligible": False},
            False,
        ),
        (
            {"power_kw": Decimal("58.0"), "wet_weight_kg": Decimal("214.0"), "a2_eligible": True},
            True,
        ),
    ],
)
def test_a2_eligible_derivation(
    fake_session: FakeAsyncSession, values: dict[str, Any], expected: bool | None
) -> None:
    motorbike = _backlog(fake_session)

    spec = asyncio.run(product_service.upsert_draft_spec(fake_session, motorbike.id, values))

    assert spec.a2_eligible is expected


# --- step 4.3: the image reads the customer catalogue needs -------------------
#
# `DISTINCT ON` is PostgreSQL syntax the in-memory `FakeAsyncSession` cannot
# interpret, so these follow the compiled-SQL convention from 3.7: a local
# recording session, and the statement itself is what is asserted.

BIKE_ID = "01J0BIKE00000000000000000A"
OTHER_BIKE_ID = "01J0BIKE00000000000000000B"

_PARAMETER = re.compile(r"%\([a-z_0-9]+\)s")


@dataclass(frozen=True, slots=True)
class _Image:
    """The one attribute the mapping is keyed by."""

    motorbike_id: str


class _RecordedScalars:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def all(self) -> list[Any]:
        return self._rows


class _RecordedResult:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def scalars(self) -> _RecordedScalars:
        return _RecordedScalars(self._rows)


class RecordingSession:
    """Records the statements issued and replays scripted rows. Never commits."""

    def __init__(self, rows: list[Any] | None = None) -> None:
        self.rows = rows if rows is not None else []
        self.statements: list[Any] = []

    async def execute(self, statement: Any) -> _RecordedResult:
        self.statements.append(statement)
        return _RecordedResult(self.rows)


def _compiled(session: RecordingSession, index: int = 0) -> Any:
    return session.statements[index].compile(dialect=postgresql.dialect())


def _sql(session: RecordingSession, index: int = 0) -> str:
    return _PARAMETER.sub("?", str(_compiled(session, index)))


def test_the_newest_approved_image_lookup_is_one_distinct_on_statement() -> None:
    """One round trip for a whole page, and approved is a `WHERE`, not a hope."""
    session = RecordingSession()

    asyncio.run(product_service.newest_approved_images(session, [BIKE_ID, OTHER_BIKE_ID]))
    sql = _sql(session)
    params = _compiled(session).params

    assert len(session.statements) == 1
    assert "SELECT DISTINCT ON (motorbike_images.motorbike_id)" in sql
    assert "motorbike_images.motorbike_id IN (__[POSTCOMPILE_motorbike_id_1])" in sql
    assert "motorbike_images.status = ?" in sql
    assert params["status_1"] is ImageStatus.APPROVED
    # The `DISTINCT ON` expression has to lead the ordering for "newest per
    # model" to be well defined at all.
    assert (
        "ORDER BY motorbike_images.motorbike_id, motorbike_images.created_at DESC, "
        "motorbike_images.id DESC" in sql
    )


def test_the_newest_approved_images_are_keyed_by_motorbike() -> None:
    """One winner per model; a model without an approved image is simply absent."""
    session = RecordingSession([_Image(BIKE_ID)])

    images = asyncio.run(product_service.newest_approved_images(session, [BIKE_ID, OTHER_BIKE_ID]))

    assert set(images) == {BIKE_ID}
    assert images[BIKE_ID].motorbike_id == BIKE_ID


def test_no_ids_means_no_image_round_trip() -> None:
    """An empty page is answered without asking the database."""
    session = RecordingSession()

    assert asyncio.run(product_service.newest_approved_images(session, [])) == {}
    assert session.statements == []


def test_list_images_stays_unfiltered_by_moderation_state_by_default() -> None:
    """The admin review screen must keep seeing pending pictures."""
    session = RecordingSession()

    asyncio.run(product_service.list_images(session, motorbike_id=BIKE_ID))
    sql = _sql(session)

    assert "motorbike_images.status" not in sql.split("WHERE")[1]
    assert "ORDER BY motorbike_images.created_at DESC, motorbike_images.id DESC" in sql


def test_list_images_restricts_to_the_requested_moderation_states() -> None:
    """The customer gallery asks for approved rows in SQL, not after the fact."""
    session = RecordingSession()

    asyncio.run(
        product_service.list_images(session, motorbike_id=BIKE_ID, statuses=[ImageStatus.APPROVED])
    )

    assert "motorbike_images.status IN (__[POSTCOMPILE_status_1])" in _sql(session)
    assert _compiled(session).params["status_1"] == [ImageStatus.APPROVED]


# `normalise_buildingline` / `list_buildinglines` — reads only, no writes.

_MANUFACTURER_ID = "01J0MANUFACTURER00000000AA"
_OTHER_MANUFACTURER_ID = "01J0MANUFACTURER00000000BB"


def test_list_buildinglines_returns_distinct_non_null_values_sorted(
    fake_session: FakeAsyncSession,
) -> None:
    gs = _backlog(fake_session, "BMW R 1250 GS")
    gs.manufacturer_id = _MANUFACTURER_ID
    gs.buildingline = "GS"
    rt = _backlog(fake_session, "BMW R 1250 RT")
    rt.manufacturer_id = _MANUFACTURER_ID
    rt.buildingline = "RT"
    duplicate_family = _backlog(fake_session, "BMW R 1300 GS")
    duplicate_family.manufacturer_id = _MANUFACTURER_ID
    duplicate_family.buildingline = "GS"
    no_family = _backlog(fake_session, "BMW F 900 R")
    no_family.manufacturer_id = _MANUFACTURER_ID
    other_brand = _backlog(fake_session, "Honda Africa Twin")
    other_brand.manufacturer_id = _OTHER_MANUFACTURER_ID
    other_brand.buildingline = "Africa Twin"

    result = asyncio.run(product_service.list_buildinglines(fake_session, _MANUFACTURER_ID))

    assert result == ["GS", "RT"]


def test_list_buildinglines_no_writes(fake_session: FakeAsyncSession) -> None:
    asyncio.run(product_service.list_buildinglines(fake_session, _MANUFACTURER_ID))

    assert fake_session.commit_count == 0


def test_normalise_buildingline_trims_and_collapses_inner_whitespace(
    fake_session: FakeAsyncSession,
) -> None:
    result = asyncio.run(
        product_service.normalise_buildingline(fake_session, _MANUFACTURER_ID, "  GS   Adventure  ")
    )

    assert result == "GS Adventure"


def test_normalise_buildingline_empty_or_none_is_none(fake_session: FakeAsyncSession) -> None:
    assert (
        asyncio.run(product_service.normalise_buildingline(fake_session, _MANUFACTURER_ID, "   "))
        is None
    )
    assert (
        asyncio.run(product_service.normalise_buildingline(fake_session, _MANUFACTURER_ID, None))
        is None
    )


def test_normalise_buildingline_reuses_the_stored_casing(fake_session: FakeAsyncSession) -> None:
    gs = _backlog(fake_session, "BMW R 1250 GS")
    gs.manufacturer_id = _MANUFACTURER_ID
    gs.buildingline = "GS"

    result = asyncio.run(
        product_service.normalise_buildingline(fake_session, _MANUFACTURER_ID, "gs")
    )

    assert result == "GS"


def test_normalise_buildingline_first_writer_spelling_is_never_overwritten(
    fake_session: FakeAsyncSession,
) -> None:
    # The match is case-insensitive, not whitespace-insensitive: "GS" and
    # "G S" are different family names, so only a same-shaped later spelling
    # joins the first writer's casing.
    gs = _backlog(fake_session, "BMW R 1250 GS Adventure")
    gs.manufacturer_id = _MANUFACTURER_ID
    gs.buildingline = "GS Adventure"

    result = asyncio.run(
        product_service.normalise_buildingline(fake_session, _MANUFACTURER_ID, "gs   ADVENTURE")
    )

    assert result == "GS Adventure"


def test_normalise_buildingline_new_spelling_stands_when_no_match_exists(
    fake_session: FakeAsyncSession,
) -> None:
    result = asyncio.run(
        product_service.normalise_buildingline(fake_session, _MANUFACTURER_ID, "GS")
    )

    assert result == "GS"


def test_normalise_buildingline_no_writes(fake_session: FakeAsyncSession) -> None:
    asyncio.run(product_service.normalise_buildingline(fake_session, _MANUFACTURER_ID, "GS"))

    assert fake_session.commit_count == 0
