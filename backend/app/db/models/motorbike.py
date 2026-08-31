"""The `motorbikes` table: one catalogue entry per model."""

from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import DateTime, Enum, ForeignKey, SmallInteger, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models.base import ULID_LENGTH, Base, ULIDPrimaryKeyMixin

NAME_LENGTH = 160
SLUG_LENGTH = 160
MODEL_NAME_LENGTH = 128


class MotorbikeStatus(StrEnum):
    """Position of a catalogue entry in the curation workflow.

    Legal transitions are enforced by `app.services.product_service.transition`;
    `rejected` is deliberately **not** terminal (an admin re-queues ingestion).
    """

    BACKLOG = "backlog"
    INGESTING = "ingesting"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    REJECTED = "rejected"


class Motorbike(ULIDPrimaryKeyMixin, Base):
    """A motorcycle model the catalogue knows about.

    `name` keeps the display form an admin typed ("Suzuki GSR 600"); `slug` is
    the derived, unique identity used to reject duplicates. Structured fields
    (`manufacturer_id`, `model_name`, years) stay NULL until extraction or an
    admin fills them in.

    The brand lives in the `manufacturers` table, referenced by id: there is no
    relationship, so callers resolve it through `manufacturer_service`.

    `suggestion` is the unverified counterpart of those structured fields: what
    whoever proposed the model claimed about it. It is a hint for ingestion and
    for the reviewing admin — **never** a fact, and never rendered as one.
    """

    __tablename__ = "motorbikes"

    name: Mapped[str] = mapped_column(String(NAME_LENGTH))
    slug: Mapped[str] = mapped_column(String(SLUG_LENGTH), unique=True)
    # No `ondelete`: nothing ever deletes a manufacturer, so the default NO
    # ACTION is the guard against a dangling reference.
    manufacturer_id: Mapped[str | None] = mapped_column(
        String(ULID_LENGTH), ForeignKey("manufacturers.id"), index=True
    )
    model_name: Mapped[str | None] = mapped_column(String(MODEL_NAME_LENGTH))
    year_from: Mapped[int | None] = mapped_column(SmallInteger)
    year_to: Mapped[int | None] = mapped_column(SmallInteger)
    # Free-shape on purpose: a suggestion carries whatever its source knew
    # (year range, type codes, links, the raw line). The keys the importer
    # writes are documented in `app.cli.suggestions`; nothing filters on them,
    # so the column stays a JSON document rather than a set of columns.
    suggestion: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    status: Mapped[MotorbikeStatus] = mapped_column(
        # Native PostgreSQL enum carrying the member *values* (see `User.role`).
        Enum(
            MotorbikeStatus,
            name="motorbike_status",
            values_callable=lambda enum: [member.value for member in enum],
        ),
        server_default=MotorbikeStatus.BACKLOG.value,
        # The backlog screen and every filtered list query on this column.
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
