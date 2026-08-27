"""Schemas for the `products` resource.

Wire shape is pinned by `docs/roadmap/phase-2/shared-knowledge.md`: resource
type `products`, camelCase attributes, specification objects mirroring the
frozen column set (`null` when the model has no such revision).

`manufacturer` is the one attribute that is **derived** rather than a column: it
carries the name of the related `manufacturers` row (`null` when the model has
no brand assigned), which the endpoint resolves — see
`docs/roadmap/phase-2b/shared-knowledge.md`. The shape is unchanged by that.

Two specification models on purpose:

* `SpecAttributes` is what a specification looks like on the way *out* — no
  range constraints, because it renders whatever the database holds;
* `DraftSpecRequest` is what an admin may write. It carries the boundary
  validation (positive numbers, column ranges, the pinned category and
  price-band vocabularies) and rejects unknown keys, so
  `product_service.upsert_draft_spec` never sees a field outside the frozen set
  (that would be a bug there, not user input).

`verifiedSpec` is read-only everywhere: approval promotes a draft, and no API
path writes a `verified` row. `extra="forbid"` on the request models is what
turns a `verifiedSpec` in a PATCH body into a 422 instead of a silent no-op.
"""

import string
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.api.jsonapi import Document, JsonApiModel, ListDocument, Resource
from app.db.models.motorbike import NAME_LENGTH, MotorbikeStatus
from app.db.models.motorbike_spec import PRICE_BANDS, SPEC_CATEGORIES

PRODUCT_TYPE = "products"

# Column ceilings, so an out-of-range value is a 422 at the boundary instead of
# a database error further in. See the frozen column set in the ORM model.
SMALLINT_MAX = 32_767
INTEGER_MAX = 2_147_483_647
NUMERIC_5_1_MAX = 9_999.9
NUMERIC_4_1_MAX = 999.9

# What `product_service.slugify` keeps; a name without one of these has no
# identity to be unique on.
SLUG_CHARACTERS = frozenset(string.ascii_lowercase + string.digits)

# The pinned vocabularies as enums, so they reach OpenAPI (and therefore the
# review form's select options) instead of being free text. Built from the
# single source of truth in the ORM model — they cannot drift.
SpecCategory = StrEnum("SpecCategory", {value.upper(): value for value in SPEC_CATEGORIES})
PriceBand = StrEnum("PriceBand", {value.upper(): value for value in PRICE_BANDS})


class SpecAttributes(JsonApiModel):
    """One specification revision of a product, as returned."""

    # Built straight from the ORM row.
    model_config = ConfigDict(from_attributes=True)

    category: SpecCategory | None
    engine_cc: int | None
    cylinders: int | None
    power_kw: float | None
    torque_nm: float | None
    wet_weight_kg: float | None
    seat_height_mm: int | None
    tank_capacity_l: float | None
    top_speed_kmh: int | None
    abs: bool | None
    a2_eligible: bool | None
    price_band: PriceBand | None
    msrp_eur: int | None
    extra: dict[str, Any]
    source_hints: dict[str, Any] | None
    extracted_at: datetime | None


class ProductAttributes(JsonApiModel):
    """The pinned attribute set of a product."""

    name: str
    slug: str
    # Derived: the related manufacturer's name, `null` when none is assigned.
    manufacturer: str | None
    model_name: str | None
    year_from: int | None
    year_to: int | None
    status: MotorbikeStatus
    draft_spec: SpecAttributes | None
    verified_spec: SpecAttributes | None
    created_at: datetime
    updated_at: datetime


class ProductResource(Resource[ProductAttributes]):
    """A product resource object."""

    type: Literal["products"] = PRODUCT_TYPE


class ProductDocument(Document[ProductResource]):
    """Body of `GET`/`POST`/`PATCH` on a single product."""


class ProductListDocument(ListDocument[ProductResource]):
    """Body of `GET /api/products`."""


class DraftSpecRequest(JsonApiModel):
    """A full draft specification: every omitted field is reset.

    Full-object replace is the pinned semantics — the SPA merges the last
    fetched `draftSpec` with its form values before sending, so fields the form
    does not show survive a save.
    """

    model_config = ConfigDict(extra="forbid")

    category: SpecCategory | None = None
    engine_cc: Annotated[int | None, Field(gt=0, le=INTEGER_MAX)] = None
    cylinders: Annotated[int | None, Field(gt=0, le=SMALLINT_MAX)] = None
    power_kw: Annotated[float | None, Field(gt=0, le=NUMERIC_5_1_MAX)] = None
    torque_nm: Annotated[float | None, Field(gt=0, le=NUMERIC_5_1_MAX)] = None
    wet_weight_kg: Annotated[float | None, Field(gt=0, le=NUMERIC_5_1_MAX)] = None
    seat_height_mm: Annotated[int | None, Field(gt=0, le=SMALLINT_MAX)] = None
    tank_capacity_l: Annotated[float | None, Field(gt=0, le=NUMERIC_4_1_MAX)] = None
    top_speed_kmh: Annotated[int | None, Field(gt=0, le=SMALLINT_MAX)] = None
    abs: bool | None = None
    # An explicit value always wins; null lets the service derive it.
    a2_eligible: bool | None = None
    price_band: PriceBand | None = None
    msrp_eur: Annotated[int | None, Field(gt=0, le=INTEGER_MAX)] = None
    extra: dict[str, Any] | None = None
    source_hints: dict[str, Any] | None = None
    extracted_at: datetime | None = None


class ProductCreateAttributes(JsonApiModel):
    """The single attribute a new catalogue entry is created from."""

    model_config = ConfigDict(extra="forbid")

    name: Annotated[
        str,
        Field(
            min_length=1,
            max_length=NAME_LENGTH,
            description='Display name as entered, e.g. "Suzuki GSR 600".',
        ),
    ]

    @field_validator("name")
    @classmethod
    def check_name_has_slug_characters(cls, value: str) -> str:
        """Trim the name and reject one the slugifier would reduce to nothing."""
        stripped = value.strip()
        if not SLUG_CHARACTERS & set(stripped.lower()):
            raise ValueError("Name must contain at least one ASCII letter or digit.")
        return stripped


class ProductPatchAttributes(JsonApiModel):
    """The writable attributes of an existing product.

    Both are optional; `verifiedSpec` (and anything else) is rejected outright.
    """

    model_config = ConfigDict(extra="forbid")

    status: MotorbikeStatus | None = Field(
        default=None,
        description="Target status; must be legal for the current one.",
    )
    draft_spec: DraftSpecRequest | None = Field(
        default=None,
        description="Full replacement of the draft specification.",
    )


class ProductCreateResource(BaseModel):
    """The resource object of a create request."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["products"] = PRODUCT_TYPE
    attributes: ProductCreateAttributes


class ProductPatchResource(BaseModel):
    """The resource object of an update request."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["products"] = PRODUCT_TYPE
    attributes: ProductPatchAttributes


class ProductCreateRequest(BaseModel):
    """Body of `POST /api/products`."""

    model_config = ConfigDict(extra="forbid")

    data: ProductCreateResource


class ProductPatchRequest(BaseModel):
    """Body of `PATCH /api/products/{id}`."""

    model_config = ConfigDict(extra="forbid")

    data: ProductPatchResource
