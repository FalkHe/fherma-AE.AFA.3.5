# Phase 2b — Shared knowledge (binding contract)

Interlude phase between Phase 2 (catalogue & ingestion, done) and Phase 3
(advisor, sliced but not started). **Goal: manufacturers become a first-class
table instead of a free-text column on `motorbikes`, extraction fills it, and
an admin-only read API exposes it.** Admin UI for managing manufacturers is
**out of scope** (owner decision, 2026-08-27).

Everything in this file is pinned. Phase-2 conventions apply verbatim unless
superseded here: ULID `String(26)` PKs via `ULIDPrimaryKeyMixin`,
`TIMESTAMPTZ` UTC with server defaults, naming convention on `Base.metadata`,
**no ORM relationships** (FK + service-level lookup, the `get_specs` pattern),
services own transactions and commit, JSON:API conventions from
[`../phase-2/shared-knowledge.md`](../phase-2/shared-knowledge.md).

---

## Owner decisions (2026-08-27)

- **Logo storage**: MEDIA_DIR-relative path (`logo_path`), mirroring
  `motorbike_images.original_path` and the existing `/media` static serving.
  No external URLs, no upload machinery yet — the column stays NULL until an
  admin surface exists.
- **Legacy column**: `motorbikes.manufacturer` (String(64) NULL) is
  **dropped** in the 2b.1 migration, after backfill. One source of truth; the
  API wire shape is preserved by derivation.
- **Extraction**: extended now (2b.2) — otherwise nothing ever writes the
  table, since admin UI is out of scope.
- **Read API**: `GET /api/manufacturers` (+ detail) added now (2b.3),
  admin-only like every Phase-2 endpoint. Customer-facing exposure (catalogue
  filter) stays a Phase-4 step-4.2 decision.
- **Backfill of existing bikes**: via a deterministic CLI command, **never**
  re-ingestion — re-ingestion's fresh-run semantics delete documents and
  embeddings, which would break Phase-3 prerequisite A2 (approved, embedded
  models must survive).
- **Not** in the products payload: manufacturer `description`/`logoPath`. The
  pinned `products` attribute set stays frozen.

## DB schema — final (step 2b.1, the only Phase-2b migration)

**`manufacturers`**

| Column | Type / constraint |
|---|---|
| `id` | `String(26)` PK (ULID) |
| `name` | `String(64) NOT NULL` — display form, first-seen casing ("Suzuki") |
| `slug` | `String(64) NOT NULL`, unique `uq_manufacturers_slug` — same pinned slugify as motorbikes (lowercase, `[^a-z0-9]+` → `-`, trimmed); the get-or-create identity, so "BMW " / "bmw" dedupe |
| `description` | `Text NULL` — short description; NULL until an admin surface exists |
| `logo_path` | `String(512) NULL` — MEDIA_DIR-relative (see owner decisions) |
| `created_at`, `updated_at` | as `motorbikes` (server default `now()`, server-side `onupdate` — the refresh-after-write rule applies) |

**`motorbikes` changes**

- Add `manufacturer_id String(26) NULL`, FK → `manufacturers.id` (default NO
  ACTION — no delete path exists), index `ix_motorbikes_manufacturer_id`.
- **Drop** `manufacturer String(64)`.

**Migration** — one revision off head `0a65339a924a`. Upgrade order:
create `manufacturers` → add FK column + index → backfill (`SELECT DISTINCT`
trimmed, non-empty legacy strings → one manufacturers row each, ULIDs
generated in the migration via `from ulid import ULID`; slugify inlined as
the pinned two-line regex, never imported from `app.services`) → drop the
legacy column. Downgrade reverses exactly: re-add `manufacturer String(64)
NULL`, restore names from the related rows, drop index/FK/column, drop table.
Round-trip is lossless up to whitespace/casing normalization. No enum types →
no `DROP TYPE`. (On the live dev DB the backfill is a no-op: all existing
rows have `manufacturer = NULL` — verified 2026-08-27.)

## Services

`backend/app/services/manufacturer_service.py` (module-level functions,
`AsyncSession` first, public functions commit):

- `normalize_name(raw) -> str | None` — strip, collapse internal whitespace,
  truncate to 64; empty → `None`.
- `get_or_create(session, name) -> Manufacturer` — identity is the slug; on
  `IntegrityError` (parallel ingestions) rollback + re-select.
- `get_by_ids(session, ids) -> dict[str, Manufacturer]` — read companion for
  the products routes (the `get_specs` pattern).
- `list_manufacturers(session, *, limit, offset) -> (rows, total)` — ordered
  by `name`, for the 2b.3 endpoint.

`product_service.assign_manufacturer(session, motorbike, manufacturer_id:
str | None)` — sets the FK, commits, `_announce`s `product.updated` (the
backlog renders the name live).

## JSON:API resources

**`products` — wire shape unchanged.** The pinned attribute set stays
verbatim; `manufacturer` is now **derived**: the related manufacturer's
`name`, `null` when unassigned. No relationships/includes (the jsonapi layer
still defers include machinery). `_resource(...)` gains a
`manufacturers: Mapping[str, Manufacturer]` argument filled by one
`get_by_ids` call per request. Expected consequence: `make generate-api`
leaves `frontend/src/api/schema.d.ts`'s products types byte-identical.

**`manufacturers`** (step 2b.3) — resource type `manufacturers`, attributes
`name, slug, description, logoPath, createdAt, updatedAt` (camelCase, `null`
when absent). Read-only:

- `GET /api/manufacturers` — page-number pagination, sorted by `name`; no
  filters.
- `GET /api/manufacturers/{id}` — 404 code `not-found` like products.
- Whole router `Depends(current_admin)` (Phase-2 rule: reads included, this
  is an admin surface). No writes — creation happens only via
  `get_or_create` (extraction/CLI).

## Extraction (step 2b.2)

- `ExtractedSpec` gains `manufacturer: str | None` (brand name only, e.g.
  "Suzuki"; null if unclear). **Excluded from `to_spec_values()`** — it is
  not in the frozen `SPEC_FIELDS` and `upsert_draft_spec` would raise. The
  overridden `model_json_schema` lists every property in `required`, so the
  new field rides along (the 2.17 OpenRouter constraint).
- Prompt (`spec_extraction.md`): one added instruction — brand only, no model
  suffix; untrusted-content hygiene unchanged.
- `spec_extraction_service`: after the successful `upsert_draft_spec`,
  `normalize_name` → `get_or_create` → `assign_manufacturer`. Null/empty →
  skip. **A bad manufacturer never costs the run its spec** (same policy as
  the rest of the service).

## CLI (step 2b.2)

`app catalogue set-manufacturer <slug> "<name>"` — deterministic, no LLM:
resolve motorbike by slug (unknown → stderr + exit 1, the `fetch-image`
precedent), `get_or_create` + `assign_manufacturer`. This is the backfill
tool for the 3 existing approved bikes and the only manual correction path
until an admin UI exists.

## Invariants QA must protect (2b.4)

- Embeddings intact: `SELECT count(*) FROM chunks WHERE embedding IS NOT
  NULL` unchanged across the whole phase (Phase-3 prerequisite A2).
- Products API wire shape unchanged; status transition matrix undisturbed.
- Migration downgrade/upgrade round-trip with a pre-seeded legacy string.

## Step order

`2b.1` → (`2b.2`, `2b.3` — independent, sequential dispatch) → `2b.4`
(acceptance; tag `phase-2b-done`). Phase 3 dispatching may then begin against
the updated head pointer.

## Landed decisions

Dev agents: append cross-step decisions here (one `### Step 2b.N` subsection
each), exactly like Phase 2. **2b.1 must record the new migration revision id
here** — phase-3's `shared-knowledge.md` and `step-3.1.md` reference it.

### Step 2b.1 (manufacturers table, migration & derived attribute)

- **Migration `485b2042d7f8` (`add_manufacturers_table`) is the new head**
  (revises `0a65339a924a`); the phase-3 head pointers in
  `../phase-3/shared-knowledge.md` and `../phase-3/step-3.1.md` now name it.
  Hand-written, not autogenerated (order: create table → FK column + index →
  backfill → drop legacy column); `alembic check` is clean, so the ORM fully
  expresses the schema. Round-trip verified on the dev DB with two
  differently-spelled legacy strings ("  Suzuki  " / "suzuki") — they backfilled
  into **one** row (grouping is on the slug, not the raw string) and the
  downgrade restored both as the normalised `Suzuki`.
- **`manufacturer_service` contract** (module-level, `AsyncSession` first,
  public functions commit): `normalize_name(raw: str | None) -> str | None`
  (strip, collapse internal whitespace, truncate 64, empty → `None`; casing
  kept), `get_or_create(session, name)` — **normalises `name` itself**, so a
  caller may pass raw text; it raises `ValueError` when the name has no slug
  characters (`"???"`), which 2b.2's extraction/CLI must treat as "skip the
  manufacturer, keep the spec"; `get_by_ids(session, ids) -> dict[str,
  Manufacturer]` (empty ids → `{}`, unknown id absent) and
  `list_manufacturers(session, *, limit, offset)` ordered by `name` **without a
  tiebreaker** (equal names derive the same unique slug, so a duplicate name
  cannot exist). `slugify` is imported from `product_service` — one rule for
  both tables; only the migration inlines it.
- **`product_service.assign_manufacturer(session, motorbike, manufacturer_id |
  None)`** commits and announces `product.updated`; `None` clears the reference.
  It is the only writer of `motorbikes.manufacturer_id`. On the API side
  `manufacturer` is derived in `endpoints/products.py`: `_resource(motorbike,
  specs, manufacturers)` plus `_manufacturers_of(session, motorbikes)` (one
  `get_by_ids` per request, list and detail), and a dangling/unknown id renders
  `null` rather than failing. `make generate-api` left
  `frontend/src/api/schema.d.ts` and `frontend/openapi.json` byte-identical.
- **Test seam for 2b.2/2b.4:** the shared `FakeAsyncSession` was left untouched
  (it still has no `rollback`); `tests/services/test_manufacturer_service.py`
  carries a local `_RacingSession` subclass that fails the first commit with
  `IntegrityError` and simulates the winning transaction's row, and
  `tests/api/test_products.py::_assign_manufacturer` is the fixture helper that
  creates the `manufacturers` row a derived attribute needs.
