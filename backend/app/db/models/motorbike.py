"""The `motorbikes` table: one catalogue entry per model."""

from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, Enum, SmallInteger, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models.base import Base, ULIDPrimaryKeyMixin

NAME_LENGTH = 160
SLUG_LENGTH = 160
MANUFACTURER_LENGTH = 64
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
    (`manufacturer`, `model_name`, years) stay NULL until extraction or an admin
    fills them in.
    """

    __tablename__ = "motorbikes"

    name: Mapped[str] = mapped_column(String(NAME_LENGTH))
    slug: Mapped[str] = mapped_column(String(SLUG_LENGTH), unique=True)
    manufacturer: Mapped[str | None] = mapped_column(String(MANUFACTURER_LENGTH))
    model_name: Mapped[str | None] = mapped_column(String(MODEL_NAME_LENGTH))
    year_from: Mapped[int | None] = mapped_column(SmallInteger)
    year_to: Mapped[int | None] = mapped_column(SmallInteger)
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
