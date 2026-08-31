# Phase 6 — Shared Knowledge (binding contract)

This document is the **single source of truth** for every Phase-6 step. Every
agent working on a Phase-6 step must read it fully before writing code. When a
step file and this document disagree, this document wins. Do not deviate from
anything pinned here — if a deviation seems necessary, **stop and report it
instead of improvising**, because a parallel agent is building against the same
contract.

UI states and layouts live in [`ui-spec.md`](ui-spec.md) (binding for every
frontend step, written at slicing time by the ui-ux-designer). Naming
rendering rules live in
[`../model-naming-display-spec.md`](../model-naming-display-spec.md); the target
schema and its rationale in
[`../model-naming-data-model.md`](../model-naming-data-model.md); the domain
knowledge and the owner's implementation deviations in
[`../../model-naming.md`](../../model-naming.md).

Phase-1/2/2b/3/4/5 conventions
([`../phase-1/shared-knowledge.md`](../phase-1/shared-knowledge.md),
[`../phase-2/shared-knowledge.md`](../phase-2/shared-knowledge.md),
[`../phase-2b/shared-knowledge.md`](../phase-2b/shared-knowledge.md),
[`../phase-3/shared-knowledge.md`](../phase-3/shared-knowledge.md),
[`../phase-4/shared-knowledge.md`](../phase-4/shared-knowledge.md),
[`../phase-5/shared-knowledge.md`](../phase-5/shared-knowledge.md), each
including its **Landed decisions**) continue to apply — in particular: ULID
PKs, **no ORM relationships**, services own transactions, get-or-create by
slug, the JSON:API layer (`app/api/jsonapi.py`), the error-shape split, the
operations lifecycle and SSE fan-out, the Taskiq patterns
(`TransientJobError` is the only retried exception), the pinned camelCase
tool-result shapes, and every frontend hook/`queryKeys`/`EmptyState`/skeleton
convention.

**Scope note (sliced 2026-08-31).** The roadmap's Phase-6 items **6.1–6.8** are
*themes*, not steps. They are re-sliced here into the executable steps
**6.9–6.31**; the theme→step mapping is in
[§ Theme mapping](#theme-mapping). The nine `N1`–`N9` slices in
[`../model-naming-data-model.md`](../model-naming-data-model.md) §7 are
**superseded** by these step numbers (the merge that doc asks for has happened:
N1/N5/N6 are folded into the identity steps, and no work runs twice).

---

## Hard rules for every Phase-6 step

- **Exactly four migrations in this phase, created in this order:**
  1. **6.9** — rename `motorbikes.name` → `query_name`
  2. **6.10** — `motorbikes.buildingline`, `type_codes`, `variants`
  3. **6.13** — `motorbike_used_prices` table + `source_type` enum value `listing`
  4. **6.18** — the `approved ⇒ identity complete` CHECK constraint

  Alembic head at phase start is **`c3a91f28b4d7`**. Each migration's
  `down_revision` is the previous one in this list. A step that finds a
  different head than its predecessor implies **stops and reports** — do not
  create a branching head, and do not merge heads. Any *fifth* schema need is a
  stop-and-report.
- **Every migration proves a round trip**: `alembic upgrade head` →
  `downgrade -1` → `upgrade head`, run inside the container, output pasted into
  the step's report.
- **New dependencies: zero, both tracks.** The robots.txt gate (6.21) uses the
  **stdlib** `urllib.robotparser`. No scraping library, no HTML-parsing
  addition, no frontend package — anything else is a stop-and-report.
- **New config keys: exactly one** — `USED_PRICE_MAX_AGE_DAYS` (int, default
  `180`), added in **6.13** to `backend/app/core/config.py` **and** `.env.dist`
  together. Everything else is a module constant.
- **The frozen `motorbike_specs` column set does not move, does not grow, and
  is not re-parented** (data-model doc §1). `msrp_eur` and `price_band` are
  **new-bike** fields: no step overloads them with used-market data (D9).
- **No new tables beyond `motorbike_used_prices`.** No `aliases` table, no
  `buildinglines` table, no `model_years`, no `generations`, no row per trim
  (owner decisions D1–D6, data-model doc §0).
- **Pinned wire shapes stay additive.** Every Phase-3 tool-result shape and
  every Phase-4 API attribute keeps its key and its type; steps add fields, they
  never rename, retype or remove one. `products.name` keeps its key and becomes
  the *rendered* name (D10).
- **`docker compose restart app-worker`** after landing any step that changes
  job-executed code — **6.14, 6.15, 6.16, 6.17, 6.19** (the 2b.4 operational
  pin). A step whose live verification behaves like the old code almost always
  forgot this.
- **Never run `docker compose down -v`, and never `down` with a `--profile`
  flag expecting it to be scoped.** `down` tears down the whole project
  regardless of `--profile`; `-v` deletes `postgres-data`, which is the entire
  dev database. Use `docker compose stop` or `rm -s <service>`. Recovery is
  `app seed demo --auto-approve` plus the CLI admin bootstrap, but the
  imported 200-row backlog and its `suggestion` claims would have to be
  re-imported (`app suggestions import backend/resources/bike-list.txt`).
- **Re-ingestion is never a data-migration tool** (the 2b rule): a fresh
  ingestion run deletes that bike's documents and embeddings. Backfills are
  deterministic CLI commands (6.18), never `app ingest run`.
- **Live verifications need the stack up** (`make up`); `OPENROUTER_API_KEY`
  and `TAVILY_API_KEY` are configured in the dev `.env`.
- Backend agents never touch `frontend/`; frontend agents never touch
  `backend/`.

---

## Parallel-run rule

Two tracks run **concurrently**, plus docs and QA at the end.

```text
backend-dev:  6.9 ─► 6.10 ─► 6.11 ─► 6.12 ─► 6.13 ─►║M1║─► 6.14 ─►║M2║
              ─► 6.15 ─► 6.16 ─► 6.17 ─► 6.18 ─► 6.19 ─► 6.20 ─►║S1║
              ─► 6.21 ─► 6.22 ─► 6.23 ─►║S2║
frontend-dev: 6.24 ─► 6.25 ─► 6.26 ──────────►║S1║ 6.27 ─►║M3║─►║S2║ 6.28 ─►║M4║
docs-writer:                                                     6.29 (after 6.23)
qa:                                   6.30 (after M3, both tracks)   6.31 ─► tag phase-6-done
```

**Cross-track sync points:**

- **S1** — frontend **6.27** starts only after backend **6.20** is merged and
  `make generate-api` has been committed by 6.20. The change is additive, so
  `pnpm typecheck` must stay green across it; a break means 6.20 violated the
  additive rule.
- **S2** — frontend **6.28** starts only after backend **6.23** is merged (the
  `usedPrice` tool/API shape must be final before it is rendered).

**Within-track independence** (for an optional second backend session):
**6.13** depends on nothing in 6.9–6.12 and may run in parallel with them —
but its **migration must still be created after 6.10's** (single linear head).
**6.16** depends on nothing new either and may be pulled forward if the
identity chain stalls. Everything else is strictly sequential as drawn.

---

## Milestones (commit & tag points)

**Commit rule:** one commit per finished step, with its own verification green
(lint, types, tests, and the migration round trip where it carries one).
**Milestone rule:** a milestone is reached when all of its steps are merged on
both tracks *and* its demo criterion passes; tag it (`phase-6-m<N>`). Do not
start a later milestone's steps before the earlier milestone's demo passes.

**Every milestone is a working application.** M1 and M2 are deliberately
invisible to a user: they change the schema and the model-facing payloads
without changing a single wire shape, so the demo criterion for both is
*"everything still behaves exactly as it did at `phase-5-done`, and the new
machinery is exercisable through the CLI"*.

| Milestone | Steps (backend ∥ frontend) | Demo criterion (both tracks together) |
|---|---|---|
| **M1 — Model foundation** | 6.9–6.13 ∥ 6.24 | The app is byte-compatible with `phase-5-done`: a consultation runs, the catalogue browses, the admin review screen works, and `curl -s localhost:8000/api/products \| jq` plus `curl -s '.../api/catalogue-models?sort=name' \| jq` match captures taken before 6.9. `psql -c '\d motorbikes'` shows `query_name`, `buildingline`, `type_codes`, `variants`; `\d motorbike_used_prices` shows the new table. `app catalogue render-name <id> --context <id> <id>` prints an escalated name; `app catalogue set-identity …` recomputes a path-shaped slug and refuses to approve a row without a year range. The new admin identity/claim UI renders against stubs in all its states (ui-spec). Tag `phase-6-m1`. |
| **M2 — Fencing closed** | 6.14 (backend only) | A source document whose **page title** and **heading trail** carry "Ignore previous instructions …" reaches the advisor fenced: the model's `retrieve_bike_knowledge` payload shows the sentinels around `sourceTitle` and `headingPath`, the reply does not comply, and the persisted `tool_calls[].result` / `sources[]` JSONB is **byte-identical** to the pre-change capture (the 5.8 pin). Tag `phase-6-m2`. |
| **M3 — Researched identity live** | 6.15–6.20 ∥ 6.25, 6.27, then QA 6.30 | An imported suggestion ("BMW R 1200 GS", claim `[K25/K50]`, 2004–2018) is ingested from the admin backlog: the run starts from `suggestion.links`, searches the type codes, and fills `manufacturer`, `modelName`, `yearFrom`/`yearTo`, `typeCodes` and any `variants` the sources printed. The review screen shows claim beside finding, an admin corrects and saves an identity, approval is refused while the identity is incomplete, the slug is `bmw/r-1200-gs/2004-2018`, and the catalogue/tools render "BMW R 1200 GS (2004–2018)" — with the year range appearing **only** where two rows would otherwise collide. `Kawasaki` and `Kawasaki Motors` are one manufacturer. Tag `phase-6-m3`. |
| **M4 — Researched prices** | 6.21–6.23 ∥ 6.26, 6.28, docs 6.29, QA 6.31 | `app prices research <slug>` on an approved bike fetches only search-provider URLs, refuses a `robots.txt`-disallowed one out loud, stores `listing` documents, and writes a median + range + as-of date with per-source provenance. A cost question in the chat answers with that median, names the sources and the date, and says "indicative" when the snapshot is stale. The catalogue detail shows the dated snapshot with its sources; a bike without one shows the defined absent state, never a guess. A re-ingestion of that bike does **not** delete the price provenance, and no `listing` document enters the RAG knowledge base. Tag `phase-6-done`. |

---

## Environment prerequisites

- **`phase-5-done` tagged** — satisfied. Alembic head `c3a91f28b4d7`
  (`app suggestions import`, committed as `56d79af`).
- The **200-row imported backlog** from `backend/resources/bike-list.txt` is
  present in the dev DB with `motorbikes.suggestion` populated. It is the
  primary test corpus of this phase: pick backlog rows from it for every live
  verification rather than inventing names.
- The **3 originally approved models carry guessed prices** (Phase-4 OQ2:
  BMW S 1000 XR 18 500 € · Honda CB500F 6 800 € · Suzuki GSR600 4 200 €) and
  the seeded models carry **no year information at all**. No step may present
  those numbers as researched; 6.29 must keep saying so until 6.22 has
  replaced them.
- The seeded models' `query_name`s are free text; `render_name` falls back to
  `query_name` whenever `model_name IS NULL`, which is what keeps the existing
  test suite green through the migration (data-model doc §5, algorithm step 1).
  **That fallback is load-bearing — do not "fix" it into an error.**
- `docker compose restart app-worker` after each of 6.14–6.19.

---

## Design decisions — final (recorded 2026-08-31)

### D1 — The owner's naming decisions are binding, in full

[`../model-naming-data-model.md`](../model-naming-data-model.md) §0 decisions
**D1–D6** are the contract and are **not** re-litigated by any step:

- a `motorbikes` row **is a generation**, identified by
  `(manufacturer_id, model_name, year_from)`;
- **trims are never rows** — they live in the row's `variants` JSONB as spec
  *deltas* plus a free-text `description`;
- **no alias table** (the advisor normalises spellings; `slugify` absorbs case
  and punctuation);
- **`type_codes` is a list** of retrieval/lookup metadata — never identity,
  never in the slug, **never shown to a customer**;
- **`buildingline` is a nullable text column**, drift-guarded by one
  normalisation helper plus the review form's `Autocomplete freeSolo`;
- **trim-aware filtering is a known gap**, recorded under "Future upgrades" in
  [`../../roadmap.md`](../../roadmap.md) — not handled in this phase.

Shapes and caps are pinned in that doc §2.2 (columns), §2.4 (`type_codes`:
trimmed, upper-cased, deduplicated, `^[A-Z0-9][A-Z0-9\-/ ]{1,31}$`, ≤ 8
entries, order meaningless) and §2.5 (`variants`: ≤ 20 entries, `slug` =
`slugify(name)` unique in the row, `name` ≤ 64, `description` ≤ 400, `specs`
keys restricted to the frozen spec names + `extra`, a delta never a full set).
An entry that fails validation is **dropped with a warning on the run**, never
a failed run — the `_assign_manufacturer` precedent.

**Adjudicated at slicing time (2026-08-31), because the data-model doc's wording
is ambiguous against the real constant:** a variant's `specs` keys are

```python
VARIANT_SPEC_KEYS = tuple(
    f for f in SPEC_FIELDS if f not in ("source_hints", "extracted_at")
)
```

`SPEC_FIELDS` (`backend/app/db/models/motorbike_spec.py`) literally contains
`source_hints` and `extracted_at`, which are **extraction bookkeeping about the
row**, not properties a trim can differ in — a trim cannot have its own
`extracted_at`. `extra` **is** allowed (the doc says so explicitly), and so are
`price_band`/`msrp_eur`: a trim legitimately carries its own new-bike price.
Note this is *not* the landed `UNCOMPARED_SPEC_FIELDS` tuple in
`catalogue_search_service.py`, which also excludes `extra` — do not reuse it
here.

### D2 — Identity is written by exactly one service function

`product_service.assign_identity(session, motorbike, *, manufacturer_id,
buildingline, model_name, year_from, year_to, type_codes, variants)` (6.12) is
the **only** writer of the identity block. Extraction (6.15), the CLI (6.18)
and the API `PATCH` (6.20) all go through it. It normalises `buildingline`,
does a full-object replace, **recomputes the slug**, commits, and announces
`product.updated`. A slug collision raises the existing `DuplicateModelError`.

Two facts about the landed PATCH surface, verified at slicing time so 6.20 and
6.27 do not have to discover them:

- `POST /api/products` already maps `DuplicateModelError` to **409
  `duplicate-model`** (`api/endpoints/products.py`), but
  `PATCH /api/products/{id}` declares only 404 and 422 in its
  `jsonapi.error_responses(...)`. 6.20 adds the same 409 mapping **and**
  declares it, so the ui-spec's 409 branch is real and appears in the
  generated types.
- The PATCH handler applies its optional attribute blocks **in order**. The
  new `identity` block is applied **first**, then the draft spec, then the
  status — so one request may fill an identity and approve in the same call.
  6.20 states this order in the endpoint docstring, because reversing it would
  make that request fail the D4 guard.

### D2b — Extraction fills gaps; it never overwrites a human (adjudicated 2026-08-31)

`assign_identity` stays a **full-object replace** (D2) — but the *extraction*
caller must not use it to clobber a corrected identity. Re-ingestion is a
normal operation (a retry, a better source set), and a second extraction that
guessed worse than the admin who fixed it must not win.

The rule, and it lives in `spec_extraction_service`, not in
`product_service`: **extraction reads the row's current identity block, merges
the extracted values under "an existing non-NULL value wins", and passes the
merged block to `assign_identity`.** Field by field:

- `model_name`, `year_from`, `year_to`, `buildingline`, `manufacturer_id` —
  keep the stored value when it is not NULL; fill it when it is.
- `type_codes` — **union** of stored and extracted (codes are additive
  retrieval metadata, D1; a new source printing a new code is new
  information, not a correction).
- `variants` — keep the stored list when it is non-empty; write the extracted
  list only into an empty one.

So the first ingestion fills everything, a re-ingestion only fills what is
still missing, and an admin's correction is permanent. This needs no "edited
by a human" flag and no owner decision — which is why it is pinned here rather
than escalated. Step 6.15 owns it; 6.20's `PATCH` is unaffected (an admin
*is* the human, and their block replaces wholesale).

### D3 — Slug policy

Canonical slug is `{manufacturer-slug}/{model-slug}/{year_from}-{year_to or ""}`
(data-model doc §3): `bmw/r-1250-gs/2019-2023`, `yamaha/mt-07/2025-`. A backlog
row with no identity keeps today's `slugify(query_name)` (no slashes). The
invariant to pin and to test: **an `approved` row always has a canonical
slash-shaped slug.** Slugs are stored nowhere else — only `get_by_slug` and
`resolve_name` read them — so recomputation is safe.

### D4 — Approval requires a complete identity

`transition(..., APPROVED)` raises a new `IncompleteIdentityError` (→ 422,
code `incomplete-identity`) when `manufacturer_id`, `model_name` or `year_from`
is NULL (6.12). The matching `CHECK` constraint lands **only in 6.18**, after
the backfill, `NOT VALID` then `VALIDATE`d in the same migration so a violating
row fails the upgrade loudly. Reason for the two-step: today's approved rows
would fail the constraint on day one.

**Where the three seeded rows' year ranges come from (adjudicated
2026-08-31).** 6.18's `VALIDATE` needs them, and the review form that is
supposed to supply them does not arrive until 6.27. They are therefore entered
by the implementing agent through 6.12's `app catalogue set-identity` — but
**not from the agent's own knowledge**: each bike's Wikipedia document is
*already ingested and in the database*, so the year range is read out of that
stored document and the step's report quotes the sentence it came from. That
keeps the rule intact — a year range on a customer-visible name is sourced,
never guessed (OQ-6) — without waiting for the UI.

*Ordering exception, stated openly:* the constraint is a model change that the
owner's "model changes first" ordering would put in M1. It cannot go there —
it depends on data the backfill produces. It is the one deliberate exception,
and it is why 6.18 sits in the ingestion block.

### D5 — Rendering happens on the server, in one module

`backend/app/services/naming_service.py` (6.11) is the only place that turns
parts into a string. Escalation is three levels — buildingline (headings/facets
only) → model → model + year range — per data-model doc §5, including the
`query_name` fallback, the caller-supplied `context` set, and the
deterministic id-suffix last resort with a `logger.warning`. **The frontend
never formats a name**; `render_name` **never queries the database**.

**Adjudicated at slicing time (2026-08-31).** D5's "the frontend never formats a
name" governs every surface that renders a *persisted* name — customer and
admin alike. It does **not** forbid the review form's live preview of the
**unsaved form buffer** (display-spec §6.2), which by definition has no server
value to ask for. That preview is therefore allowed as a **panel-local helper
inside the identity panel only**: not a shared module, not exported, never
imported by a customer surface, and never used to render a value that came back
from the API. The moment a saved name is displayed, it is the server's rendered
`name`. Step 6.24 builds it that way. The
per-caller `context`/`min_level` table in that doc §5 is binding for 6.19 and
6.20.

### D6 — The claim is never catalogue data

`motorbikes.suggestion` is an **unverified claim** imported from a list. It is
an *input hint* to research and a *comparison value* for the reviewer. It is
never copied into a typed column by anything but a human clicking "use the
claim" in the review form, and it is **never** exposed on a customer-facing
resource or rendered on a customer-visible surface. Concretely: `suggestion` is
added to the admin-only `products` resource (6.20) and to **no** field of
`catalogue-models`. The `resolve_name` type-code leg may *read*
`suggestion->'type_codes'` as a retrieval hint (data-model doc §4.3) — reading
a hint to find a row is not rendering a claim.

### D7 — What gets fenced, and what does not

Fencing wraps **unreviewed, web-derived free text that the model reads**. It
never changes what is persisted or served to the UI (the 5.8 pin: the
`tool_calls[].result` / `sources[]` JSONB stays byte-identical).

- **Fenced (6.14):** `retrieve_bike_knowledge`'s `_model_view` gains
  `fencing.fence()` over `source_title` **and** `heading_path`, alongside the
  snippet `text` it already fences. Both are attacker-controlled — the page's
  own `<title>` (`ingestion/service.py::_store_document`, fed
  `outcome.page.title` / `candidate.title`) and the page's own ATX headings
  (`services/chunking.py::heading_path`).
- **Not fenced, deliberately:** the **identity strings** 6.19 renders into tool
  payloads (`manufacturer`, `model_name`, `buildingline`, year range) and the
  extracted spec values. They are web-derived, but they pass an **admin review
  gate** before a row is `approved`, and tools only ever serve approved rows —
  the review *is* the control. Fencing a rendered model name inside a JSON
  field would also corrupt the string the advisor must repeat back to the
  customer. **6.19 must preserve 6.14's fences** where they exist; a tool
  payload that loses a sentinel is a regression.
- Fencing stays a **mitigation, not a proof**. The README's "Known
  limitations" entry stands after 6.14 lands — 6.29 does not delete it.

### D8 — Used-price research: no scrapers, robots honoured (roadmap's ToS gate, closed)

The roadmap made a robots/ToS review a precondition for fetching used prices.
It was done at slicing time (2026-08-31) and this is its outcome:

- **kleinanzeigen.de `robots.txt`** (fetched 2026-08-31) disallows exactly the
  paths a price sampler would want — `/*/preis:*`, `/*/sortierung:*`,
  `/*sortierung:entfernung*`, `/s-suchanfrage.html`, `/*+options:*`,
  `/*/anbieter:*`, plus a long radius list — and the host answers a plain
  fetch slowly enough to indicate bot protection.
- **mobile.de `robots.txt`** (fetched 2026-08-31) disallows `/api/`,
  `/svc/similar/`, `/consumer/next/api/search/count`, `/s/*?` and
  `/*/*.html?` for several locales, plus `/*/*,pgn:*` pagination.

**Therefore: no purpose-built classifieds scraper, no constructed
search/filter/sort/pagination URLs, ever.** What ships instead reuses the
landed pipeline and adds one gate:

1. only URLs the **search provider itself returned** are fetched — the price
   step never builds a listing URL;
2. before the first fetch of a host, the price path checks that host's
   `robots.txt` with the **stdlib** `urllib.robotparser` and **skips a
   disallowed URL with a visible warning** in the CLI output;
3. the existing `PolitenessGate` (1 s per host) and the honest
   `USER_AGENT = "MotorcycleBuyingAdvisor/0.1 (educational project)"` in
   `backend/app/services/ingestion/fetch.py` are reused unchanged;
4. volume stays admin-triggered and single-model — a CLI command per bike, not
   a crawl;
5. the robots check is added **on the price path only**. Landed ingestion
   behaviour is not touched (no side effects, nothing to re-verify).

The honest consequence, which 6.29 must document: the researched figure is
whatever *published pages the search engine surfaced* say about used asking
prices — price guides, magazine market reports, and whatever listing pages are
reachable within the rules — not a statistical sample of a classifieds
database. `sample_count` is **NULL when the sources only state a range**, and
NULL means "unknown", never "zero".

### D9 — Used prices live in their own table, outside the draft/verified split

`motorbike_used_prices` (6.13), one row per motorbike, full-object replace per
research run (no history — out of scope):

| Column | Type | Notes |
|---|---|---|
| `id` | ULID PK | `ULIDPrimaryKeyMixin` |
| `motorbike_id` | FK → `motorbikes.id`, `ondelete="CASCADE"`, **UNIQUE** | one snapshot per bike |
| `price_min_eur` | `Integer NOT NULL` | |
| `price_max_eur` | `Integer NOT NULL` | |
| `price_median_eur` | `Integer NOT NULL` | |
| `sample_count` | `SmallInteger NULL` | **NULL = unknown** (D8) |
| `as_of` | `DateTime(timezone=True) NOT NULL` | the research run's time |
| `sources` | `JSONB NOT NULL DEFAULT '[]'::jsonb` | `[{"source_document_id","url","title","sample_count","prices":[int,…]}]`, snake_case, documented in the model docstring |
| `created_at`, `updated_at` | as on `Motorbike` | |

A run that cannot produce a median **writes nothing** — the NOT NULLs are the
guard. **No draft/verified kind split**: the split exists so an admin signs off
a spec *fact*, and a used price is deliberately not presented as a fact — the
`as_of` date, the source list and the staleness caveat are the honesty
mechanism, and adding a kind would force a change to the frozen promotion path
in `product_service`. The admin gate is that research is an admin-run CLI that
prints what it found, plus `app prices delete <id-or-slug>` to remove a bad
snapshot.

`price_band` stays **MSRP-derived new-bike vocabulary** and
`catalogue_search_service` price filtering/sorting is **unchanged** — one fewer
thing for QA to re-prove.

### D10 — Staleness: a caveat, never a refusal

`USED_PRICE_MAX_AGE_DAYS` (default `180`).
`used_price_service` owns the clock and returns a `UsedPriceSnapshot` carrying
`is_stale = (now(UTC) - as_of) > timedelta(days=…)`. The cost estimator
**never refuses** a stale price: it uses it and emits a mandatory assumption
line naming the date and the word *indicative*. Keeping the clock in the
service preserves the estimator's landed "reproducible given its inputs"
contract — the snapshot, `is_stale` included, is an input.

Purchase-price precedence in `cost_estimator_service._add_purchase`:
**used median → `msrp_eur` → `price_band` → omitted**, with the assumption
line always saying which one was used, and for the used case naming the source
hosts and the date.

### D11 — `usedPrice` is additive everywhere

`CostEstimatorResult` gains `usedPrice: {medianEur, minEur, maxEur,
sampleCount, asOf, stale, sources: [{title, url}]} | null`. Every pinned
Phase-3 field keeps its key and type. `sampleCount: null` means unknown.
The catalogue-models **detail** resource gains the same block; the **list**
resource does not (no price research on a card, and no N+1).

### D12 — `listing` documents are quarantined

`SourceType.LISTING` (added in 6.13's migration as a PG enum value — note that
PostgreSQL cannot drop an enum value, so the downgrade drops the table and
documents that the value remains) is excluded from **four** landed paths in
**6.21**. The first two were pinned at slicing time; the last two were found by
the step author reading the code, and are adjudicated in (2026-08-31) because
without them the quarantine leaks:

- `ingestion/service.py::_Run._discard_previous_run` — a re-ingestion must not
  wipe price provenance;
- `embedding_service.rebuild_motorbike` and the chunking entry point — **dated
  asking prices must never enter the RAG knowledge base**, where they would be
  retrieved as timeless prose;
- `spec_extraction_service.assemble_documents` — a listing page in the
  extraction prompt would feed asking prices into `msrp_eur`, which is a
  **new-bike** field (D9). A used ad is not a specification source;
- the customer-facing `sources[]` projection on the catalogue detail — a
  classifieds link is not provenance for a specification, and surfacing one
  invites a reader to treat an expired ad as a citation.

All four carve-outs need a test proving ingestion is otherwise untouched.
**6.21's effort is 3, not 2**, because of the two added paths.

### D13 — Contradiction warnings ride the existing mechanism

When the sources contradict a claimed year range or type code, 6.17 records it
with the existing `_Run._warn(detail)` (`ingestion/service.py`), which already
surfaces through `operation.message` and the `WARNING_SUMMARY_PREFIX`
completion summary. **No new column, no new table, no structured warning
model** — and the claim is never silently overwritten by the finding, nor the
finding by the claim: the run records both and the reviewer decides.

### D14 — Manufacturer normalisation is a known-marque list

`backend/resources/bike-list.txt` is a list of exactly the marques this
catalogue carries. 6.16 derives a known-marque set from it (a generated,
committed constant module — not a runtime parse of the resource file), and
`manufacturer_service.normalize_name` maps a case-insensitive prefix match onto
the canonical marque: `Kawasaki Motors` → `Kawasaki`, `Honda Motor` →
`Honda`. An unknown name passes through unchanged (never invent a marque).
6.16 also merges the already-split rows via the existing per-model CLI path,
and its test corpus is the real pair in the dev DB (Z400/Z900 = `Kawasaki`,
Versys 650 = `Kawasaki Motors`). This closes the Phase-5 open question
"manufacturer names are inconsistent".

### D15 — What this phase deliberately does not do

- **No trim-aware filtering** (owner D4) — recorded under "Future upgrades".
- **No `emission_standard` / `licence_class` enums** (data-model OQ-9).
- **No alias table / `aliases` column** (owner D3) — its trigger conditions
  stay in data-model doc §2.3.
- **No `a2Eligible`-vs-power validator.** It is a live Phase-5 open question
  awaiting the owner; it is unrelated to naming, prices and fencing, and
  adding it would put an unrequested behaviour change into the extraction path
  three other steps depend on. Carried in
  [`open-questions.md`](open-questions.md).
- **No touch to `POST /api/chat-messages`** — the concurrent-turn 409 race
  (Q4 / Phase-4 OQ4) stays out of scope and stays documented.
- **No admin CRUD for manufacturers**, no new screen, no new nav entry: every
  frontend step extends an existing route.

---

## Theme mapping

| Roadmap theme | Steps |
|---|---|
| 6.1 Research writes the identity fields | 6.9, 6.10, 6.11, 6.12, 6.15, 6.18, 6.19, 6.20 |
| 6.2 Suggested links and type codes as research input | 6.17 |
| 6.3 Claim vs. finding in the review UI | 6.24, 6.27 |
| 6.4 Used-price research | 6.13, 6.21, 6.22, 6.23, 6.26, 6.28 |
| 6.5 Manufacturer-name normalisation | 6.16 |
| 6.6 Structured naming model | 6.10, 6.11, 6.12, 6.25 (+ the N1–N9 merge) |
| 6.7 Fence the provenance metadata the model reads | 6.14 |
| 6.8 Cap every web-derived provenance string | 6.14 (re-scoped — see below) |

**Theme 6.8 was re-scoped at slicing time.** Its premise was wrong:
`chunking.heading_path` **already** truncates to `HEADING_PATH_LENGTH` (512)
and `chunks.heading_path` is `String(512)`, exactly like the title's
`SOURCE_TITLE_LENGTH`. There is no missing DB bound and therefore no migration.
What survives is real but smaller and belongs with the fencing work: a 512-char
heading trail is repeated on **every** chunk under that heading, so the
*token-budget* leak in the model-facing payload stands. 6.14 caps
`heading_path` and `source_title` in `_model_view` only (payload-side, no
schema change, persisted JSONB untouched) and audits the remaining web-sourced
columns, recording the audit result rather than inventing a migration.

---

## Merge-friction files

Steps that touch the same file are drawn sequentially above; if a second
session is used anyway, these are the files to watch:

- `backend/app/db/models/motorbike.py` — 6.9, 6.10
- `backend/app/services/product_service.py` — 6.12, 6.18, 6.19
- `backend/app/services/catalogue_search_service.py` — 6.19 (and **only** 6.19)
- `backend/app/llm/extraction.py` + `prompts/spec_extraction.md` — 6.15
- `backend/app/services/ingestion/service.py` — 6.17, 6.21
- `backend/app/services/spec_extraction_service.py` — 6.15 only (its new
  `identity_warnings` are carried on the extraction result and wired to
  `_Run._warn` by **6.17**, so 6.15 never edits `ingestion/service.py`)
- `backend/app/services/ingestion/search.py` — **6.17** adds the additive
  `templates:` keyword to `SearchProvider.search` (it needs it for the claimed
  type codes); **6.22** reuses that seam, which is why 6.17 is one of its
  dependencies
- `backend/app/llm/agents/tools/` — 6.14 (fences), 6.19 (rendered names), 6.23
  (`usedPrice`); **6.19 and 6.23 must not drop 6.14's fences**
- `backend/app/core/config.py` + `.env.dist` — 6.13 only
- `frontend/src/routes/admin/AdminModelReviewRoute.tsx` — 6.24, 6.25, 6.27
- `frontend/openapi.json` + `frontend/src/api/schema.d.ts` (both generated by
  `make generate-api`) — committed by **6.20** only, and again by **6.23** for the
  `usedPrice` block. There is no `frontend/src/api/types.ts`; a step that creates
  one has deviated.

---

## Landed decisions

Appended by the implementing agents — 1–3 bullets per step, no prose. Record
anything a *later* step depends on: a name, a shape, a constant, a gotcha, a
deviation that was approved. A step whose report mentions a convention or
contract and does not appear here is not finished.
