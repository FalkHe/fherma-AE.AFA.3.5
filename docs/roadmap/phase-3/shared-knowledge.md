# Phase 3 — Shared Knowledge (binding contract)

This document is the **single source of truth** for every Phase-3 step. Every
agent working on a Phase-3 step must read it fully before writing code. When a
step file and this document disagree, this document wins. Do not deviate from
anything pinned here — if a deviation seems necessary, stop and report it
instead of improvising, because a parallel agent is building against the same
contract.

UI layout/state details live in [`ui-spec.md`](ui-spec.md) (binding for
frontend steps). Phase-1 and Phase-2 conventions
([`../phase-1/shared-knowledge.md`](../phase-1/shared-knowledge.md),
[`../phase-2/shared-knowledge.md`](../phase-2/shared-knowledge.md), each
including its Landed decisions) continue to apply — in particular the JSON:API
layer (`app/api/jsonapi.py`), `operation_service` + NOTIFY, the Taskiq
patterns, `get_chat_model`/`get_embeddings`/`render_prompt`, and every
frontend hook/stub/queryKeys convention.

**Scope note:** Phase 3 contains the consultation UI formerly outlined as
Phase-4 step 4.1 — pulled forward (owner decision, 2026-08-27) so each
feature is built by frontend and backend in parallel. Phase 4 keeps catalogue
browsing (4.2) plus the one-line recommendation-card link wiring.

---

## Parallel-run rule

Two tracks run **concurrently**. Backend agents never touch `frontend/`;
frontend agents never touch `backend/`.

```text
backend-dev:  3.1 ─► 3.3 ─► 3.5 ─► 3.7 ─► 3.8 ─► 3.9 ─► 3.11 ─► 3.12 ─► 3.13 ─► 3.14 ─► 3.16
frontend-dev: 3.2✓ ─► 3.4 ─► ║S1║ 3.6 ─► 3.10 ─► ║S2║ 3.15
qa:           3.17 (after 3.15 + 3.16)
```

**Cross-track sync points (the only two):**

- **S1** — step 3.6 starts only after backend **3.3 and 3.5** are merged
  (3.3 freezes the chat OpenAPI surface; 3.5 makes replies real). First
  action: regenerate API types via the 2.15 landed image-independent
  sequence (`docker compose run --rm -T app-cli app openapi export >
  frontend/openapi.json`, then `node-cli pnpm exec openapi-typescript …`).
- **S2** — step 3.15 starts only after backend **3.13 and 3.14** are merged.
  The OpenAPI surface froze at 3.3, so no regeneration is strictly needed —
  regenerate anyway as a cheap consistency check.

Frontend steps 3.4 and 3.10 need **zero backend code** (3.4 uses the stub
rule below; 3.10 builds pure presentational components against fixture
props).

**Within-track parallelism:** backend 3.7→3.8→3.9 (the RAG brain) is
independent of the 3.1→3.3→3.5 chat vertical — an optional second backend
session may run it concurrently. Merge-friction files are listed at the
bottom. **Only step 3.1 carries a migration** — any other step discovering a
schema need must stop and report, never add a second Alembic head.

---

## Milestones (commit & tag points)

**Commit rule:** one commit per finished step (its verification green — lint,
types, tests). **Milestone rule:** a milestone is reached when all its steps
are merged on both tracks and its demo criterion passes; tag it
(`phase-3-m<N>`). Milestones are the points where frontend and backend
converge into a working feature — do not start a later milestone's sync step
before the earlier milestone's demo passes.

| Milestone | Steps (backend ∥ frontend) | Demo criterion (both tracks together) |
|---|---|---|
| **M1 — Chat plumbing & shells** | 3.1, 3.3, 3.5 ∥ 3.2✓, 3.4 | Full chat round-trip via curl: POST a chat → advisor greeting arrives; POST message → real-LLM reply; `curl -N /api/events` shows `operation.updated` (entityType `chat`) then `chat.message.created`; DELETE soft-deletes (list excludes, GET 404s); apologetic-message failure path proven (blank key in worker); chat shell renders stub conversations incl. typing state; **S1 open**. |
| **M2 — Live chat** | — ∥ 3.6 | First FE+BE convergence: "Ask the advisor" → greeting appears via typing bubble → a browser conversation with the plain-LLM advisor — seen ✓, typing over SSE, markdown replies; reload mid-response resumes the typing state; delete a consultation from the list; second account sees nothing. |
| **M3 — The RAG brain** | 3.7, 3.8, 3.9 ∥ 3.10 | `app rag ask "I'm 1.65m, just got my A2, mostly city commuting"` shows translation → spec filters → candidate shortlist → fused provenance-carrying chunks; all tool renderers/sources/cards proven on fixture data. **Prerequisite: ≥2 approved models with embeddings in the dev DB** (see Environment prerequisites). |
| **M4 — The advisor** | 3.11, 3.12, 3.13, 3.14 ∥ 3.15 | The product moment: a full browser interview with visible labelled tool results, collapsible sources, recommendation cards; preferences captured with firmness + supersession; an uncatalogued bike appears exactly once in the admin backlog. |
| **M5 — Phase acceptance** | 3.16 ∥ — then 3.17 | Demo script green; QA end-to-end with evidence; tag `phase-3-done`. |

Backend continues 3.7–3.9 while frontend lands M2 — a milestone gates only
its own steps plus the demo.

---

## Environment prerequisites

- ~~Uncommitted working tree~~ — **resolved 2026-08-27**: the owner
  committed/cleaned the tree; only the Phase-3 planning docs remained
  uncommitted at slicing time.
- ~~Approved models for M3~~ — **resolved 2026-08-27**: the owner prepared
  the DB (approved models with embeddings available). `OPENROUTER_API_KEY`
  and `TAVILY_API_KEY` are configured and live-verified.

---

## DB schema — final (step 3.1, the only Phase-3 migration)

Phase-2 conventions verbatim: ULID `String(26)` PKs via
`ULIDPrimaryKeyMixin`, `TIMESTAMPTZ` UTC, naming convention on
`Base.metadata`, native PG enums with `values_callable` (lowercase stored),
**no ORM relationships**; the migration's downgrade drops the two new enum
types explicitly (copy `4ea01933a43b`'s pattern). Head chain: `0a65339a924a`
→ Phase 2b's `485b2042d7f8` (`add_manufacturers_table`, landed 2026-08-27 —
the current head) → 3.1's revision.

**`chats`**

| Column | Type / constraint |
|---|---|
| `id` | `String(26)` PK |
| `user_id` | `String(26) NOT NULL` FK → `users.id ON DELETE CASCADE`, `ix_chats_user_id` |
| `title` | `String(160) NULL` — set once by the service from the first user message (truncated to 160); UI falls back to an i18n label while null; not user-editable |
| `active_operation_id` | `String(26) NULL` — plain string, **no FK** (operations' loose entity coupling); set by `start_response`, cleared in the same transaction that persists the assistant message (success **and** failure paths) |
| `deleted_at` | `TIMESTAMPTZ NULL` — **soft delete** (owner decision, 2026-08-27): set by `soft_delete_chat`, never unset via API (restore is a DB operation); every chat read filters `deleted_at IS NULL`, so a deleted chat (and its messages, via the ownership check) answers 404 |
| `created_at`, `updated_at` | as `users` (`updated_at` has server `onupdate` → **the refresh-after-write rule applies to chat routes**; the service bumps `updated_at` on every message append — it doubles as last-activity) |

Deliberate omission: **no `status` column** — `deleted_at` is the only
lifecycle flag; add a status column only when a feature needs one.

**`chat_messages`**

| Column | Type / constraint |
|---|---|
| `id` | PK (ULID — sortable; ordering is `created_at ASC, id ASC`, no sequence column) |
| `chat_id` | `String(26) NOT NULL` FK CASCADE, `ix_chat_messages_chat_id` |
| `role` | native enum `chat_message_role('user','assistant') NOT NULL` — system prompts are code, never rows; tool traffic lives in JSONB, never as rows |
| `body` | `Text NOT NULL` (assistant = markdown; user = plain text, ≤ **4000 chars** enforced at the API — a schema constant, not config) |
| `tool_calls` | `JSONB NOT NULL DEFAULT '[]'` |
| `sources` | `JSONB NOT NULL DEFAULT '[]'` |
| `recommendations` | `JSONB NOT NULL DEFAULT '[]'` |
| `created_at` | server default `now()` (no `updated_at` — messages are immutable) |

**`chat_preferences`**

| Column | Type / constraint |
|---|---|
| `id` | PK |
| `chat_id` | `String(26) NOT NULL` FK CASCADE, `ix_chat_preferences_chat_id` |
| `attribute` | `String(64) NOT NULL` (prompt-guided vocabulary, not DB-enforced) |
| `value` | `String(256) NOT NULL` |
| `firmness` | native enum `preference_firmness('hard','soft','exploring') NOT NULL` |
| `superseded_by_id` | `String(26) NULL` FK → `chat_preferences.id` (self-FK, no relationship); non-null = inactive |
| `created_at` | server default `now()` |

Supersession: same chat + same `attribute` ⇒ insert the new row and set the
old row's `superseded_by_id` in one transaction. Active preferences =
`superseded_by_id IS NULL`.

---

## Persisted JSONB shapes — final

**Pinned: stored camelCase**, produced with `model_dump(by_alias=True)`, so
the JSON:API layer passes them through verbatim — no per-item re-mapping at
read time (same precedent as `extra`/`source_hints`).

`tool_calls[]` item:

```json
{"id": "<provider call id or ULID>", "tool": "catalogue_search",
 "arguments": {"…camelCase args…": "…"},
 "result": {"…camelCase result…": "…"},
 "status": "succeeded" | "failed", "error": null | "<one line>"}
```

**All** executed tool calls are persisted — including `record_preference`,
`flag_unknown_bike`, `present_recommendations` (graders see them; the UI's
generic renderer covers anything unstyled).

`sources[]` item (deduped by `sourceDocumentId` keeping the best score,
ordered score desc, **capped at 8**):

```json
{"chunkId": "…", "motorbikeId": "…", "sourceDocumentId": "…",
 "sourceUrl": "https://…" | null, "sourceTitle": "…",
 "headingPath": "Suzuki GSR600 > Design" | null, "score": 0.032}
```

`recommendations[]` item — a **write-time snapshot** (plain users cannot
read `/api/products` in Phase 3, so cards must be self-contained; staleness
accepted):

```json
{"motorbikeId": "…", "name": "Honda CB500F",
 "imageUrl": "/media/motorbikes/<bike>/<image>_card.webp" | null,
 "rationale": "one line", "matchedPreferences": ["budget", "a2"],
 "keySpecs": {"category": "naked", "engineCc": 471, "powerKw": 35.0,
              "wetWeightKg": 189.0, "seatHeightMm": 785,
              "priceBand": "mid"}}
```

`imageUrl` = card variant of the newest **approved** image at persist time
(reuse the `app/api/schemas/images.py` formula), else null. The frontend
derives the thumb URL by replacing the `_card.webp` suffix with
`_thumb.webp` and prefixes both with `VITE_API_URL` in dev (the 2.20 landed
gap, fixed like commit 762e957).

---

## Tool result schemas — final (what the four renderers consume)

Every tool returns a JSON-serializable Pydantic result with camelCase
aliases; these shapes are what lands in `tool_calls[].result` and what
ui-spec §8 renders. Missing verified specs are `null` — **never a guessed
value**; tools read verified specs of approved models only.

- **`catalogue_search`**: `{"results": [{"motorbikeId", "name", "category",
  "powerKw", "wetWeightKg", "seatHeightMm", "priceBand"}], "totalCount": n}`
  (results capped at 12 in the tool; the UI displays 8 + "+n more").
- **`spec_comparison`**: `{"bikes": [{"motorbikeId", "name"}],
  "rows": [{"field": "powerKw", "values": [35.0, null, 70.5]}]}` — `field`
  is a **frozen camelCase spec column name**; `values` aligned to `bikes`
  order; every frozen spec field present in `rows` (nulls explicit). The
  client maps `field` → label via `consultations.specFields.*` and renders
  unmapped keys verbatim.
- **`licence_fit_check`**: `{"motorbikeId", "name",
  "rules": [{"rule": "a2_power", "label": "A2 power limit",
  "verdict": "pass"|"fail"|"unknown", "evidence": "35.0 kW ≤ 35 kW" | null}]}`
  — `label`/`evidence` are server-composed English strings rendered verbatim
  (same i18n exemption as operation messages); `unknown` verdicts carry the
  reason in `evidence`.
- **`cost_estimator`**: `{"motorbikeId", "name", "currency": "EUR",
  "lineItems": [{"label": "Insurance /year", "amount": 620}],
  "total": 3140, "assumptions": ["…", "…"],
  "coefficientsVersion": "2026.1"}` — labels verbatim (English, i18n-exempt);
  `currency` is always `"EUR"` (project-wide unit pin).
- **`record_preference`**: `{"attribute", "value",
  "firmness": "hard"|"soft"|"exploring"}` (ack of what was stored).
- **`flag_unknown_bike`**: `{"name", "status": "queued"|"already_known"}`.
- **Name→bike resolution failure** (shared): a tool given an unresolvable
  name returns `{"unknownBike": "<name as given>"}` instead of its normal
  result — never an exception.

---

## JSON:API resources — final (reusing `app/api/jsonapi.py` as landed in 2.3)

Both resources: `Depends(current_user)` (**not** `current_admin` — this is
the customer surface; admins are users too), writes additionally
`Depends(csrf_protect)`. Ownership violation and unknown id are both
**404 `not-found`** (no existence leak). After any write, `await
session.refresh(row)` before rendering (`chats.updated_at` server
`onupdate`).

**`chats`** — attributes: `title` (string|null), `activeOperationId`
(string|null), `createdAt`, `updatedAt` (doubles as last-activity).

- `GET /api/chats` — own chats only, `deleted_at IS NULL`; **pinned sort
  deviation: `-updatedAt`** (not the default `-createdAt`);
  `page[number]`/`page[size]` (default/max 100), `meta.totalCount`.
- `GET /api/chats/{id}` — own, non-deleted chat or 404.
- `POST /api/chats` — empty attributes object → 201. **From step 3.5 on**
  the route also calls `start_response` after creating the row, so the
  advisor opens the conversation (greeting + opening interview question —
  owner decision, 2026-08-27); the 201 response carries
  `activeOperationId` set. A chat is only ever created by the explicit
  button — never on page load.
- `DELETE /api/chats/{id}` — **soft delete** (`csrf_protect`): sets
  `deleted_at` via `chat_service.soft_delete_chat`, → 204; already-deleted
  or foreign → 404. No un-delete endpoint. Deleting emits no SSE event
  (only the owner sees the list; their own mutation invalidates).
- No PATCH (rename out of scope this phase).

**`chat-messages`** — attributes: `role`, `body`, `toolCalls`, `sources`,
`recommendations`, `createdAt`. The three JSONB attributes serialize
verbatim and are **typed in OpenAPI as arrays of the pinned item schemas**
(so the generated client is useful), with `toolCalls[].arguments/result` as
open objects.

- `GET /api/chat-messages` — `filter[chat]` **required** (absent → 400
  `missing-filter`; >1 comma-separated member → 400 `invalid-filter` — the
  2.9 precedent); **pinned sort deviation: `createdAt ASC, id ASC`** (chat
  timeline); paginated, client walks pages (2.15 pattern).
- `POST /api/chat-messages` — create request attributes `{chatId, body}`.
  **Pinned simplification:** `chatId` is an attribute, not a JSON:API
  relationship — the landed jsonapi.py has no relationship machinery and
  defers it until a resource needs it. Behaviour: validate (stripped
  non-empty, ≤4000) → `append_user_message` → `start_response` (from 3.5
  on) → 201 with the created message (the chat's `activeOperationId` is set
  as a side effect; the SPA refetches the chat detail).
  Errors: 404 `not-found` (chat), 409 `response-pending` (turn genuinely in
  flight — see healing below), 422 default FastAPI shape (body validation).

New error code this phase: `response-pending` (409). Reused: `not-found`,
`missing-filter`, `invalid-filter`.

---

## Chat response job & stale-turn healing — final

- Operation `type='chat.response'`, `entity_type='chat'`,
  `entity_id=chat.id`, standard `operation_service` lifecycle. Task
  `chat.respond(chat_id, operation_id)` in `backend/app/jobs/chat.py` — ids
  only, own session, `TransientJobError` for gateway timeouts, any other
  failure → persist the apologetic assistant message + operation `failed`
  (**never a silent dead chat**). `app.jobs.chat` appended to `app-worker`'s
  command in `compose.yaml`.
- Enqueue seam (the 2.14 pattern verbatim):
  `chat_service.start_response(session, chat) -> Operation` — create
  operation, set `active_operation_id`, commit, then
  `enqueue_chat_response(...)` (in-function import of `app.jobs.chat`;
  autouse stub fixture in `tests/conftest.py` records enqueues).
- `chat_response_service.generate(session, chat, operation)` is **the seam
  3.13 rewires** — the job itself never changes after 3.5.
- **The advisor speaks first (owner decision):** `POST /api/chats` calls
  `start_response` on the fresh, empty chat; the system prompt instructs the
  model to greet and ask the opening interview question when the history is
  empty. The greeting is an ordinary assistant message (announced via
  `chat.message.created`, renders as a normal bubble); it does **not** set
  the chat title — the title still comes from the first **user** message.
- **Model split (owner decision):** the advisor (this responder and the
  3.13 agent loop) uses `get_chat_model(settings.advisor_model)` — a new
  config key `ADVISOR_MODEL`, added in 3.5. `CHAT_MODEL` remains the
  ingestion/extraction + utility model (3.8's query translation uses it).
  Exact model ids are `.env` values, changeable without code — never
  hardcode or assert a specific id.
- **Stale-turn healing (pinned; this is the kill-the-worker resumability
  story):** on `POST /api/chat-messages`, if the chat has an
  `active_operation_id`:
  - operation already `succeeded`/`failed` → clear the pointer, accept the
    message (fresh turn);
  - operation `queued`/`running` but its `created_at` is older than
    `AGENT_TIMEOUT_SECONDS + 30` seconds → mark it `failed`
    (error `"Response timed out."`), clear the pointer, accept the message;
  - otherwise → 409 `response-pending`.
- **Frontend mirror:** `CHAT_TURN_STALE_SECONDS = 150` (= 120 + 30) — after
  that long in the typing state the UI shows the failed-turn row and
  re-enables the composer (ui-spec §3.3 state 4). Keep the two constants in
  lockstep if `AGENT_TIMEOUT_SECONDS` ever changes.

---

## SSE / events — final

- New payload (≤1 KB, ids only, clients refetch):
  `{"event": "chat.message.created", "chatId": "…", "messageId": "…",
  "role": "assistant"}`.
- **Emitter assignment (an event without an assigned emitter is a bug):**
  `chat.message.created` — `chat_service.append_assistant_message` only,
  via `operation_service.notify` (the project's only `app_events` writer),
  after the message-insert commit. User messages emit nothing (the author
  already knows). `operation.updated` for `entity_type='chat'` comes free
  from the existing `operation_service` lifecycle.
- **The customer chat UI consumes exactly two events** (invalidation map in
  `useServerEvents.ts`): `chat.message.created` → invalidate
  `["chatMessages"]` + `["chats"]`; `operation.updated` with
  `entityType === "chat"` → additionally invalidate `["chats"]` (keep the
  existing `["operations"]` invalidation for admin screens). Reconnect
  blanket invalidation gains `["chats"]` + `["chatMessages"]`.
- **Pinned: the typing indicator is driven solely by
  `chat.activeOperationId`** — never by `/api/operations` (that endpoint is
  `current_admin`; **do not relax it** — operations have no owner column)
  and never by the SSE payload alone (it carries no status). Seen ✓ = the
  successful POST response. The failure path needs no special event: the
  apologetic message emits `chat.message.created` like any reply.

---

## Agent-loop decisions — final

- **Mechanism: hand-rolled plain tool loop over
  `ChatOpenRouter.bind_tools(tools)`** (model =
  `get_chat_model(settings.advisor_model)`) — no LangGraph, no prebuilt
  agent executor, no checkpointer (architecture: resumability =
  persistence).
  Loop: system + rebuilt history → `ainvoke` → while `tool_calls` present
  and step budget remains: execute sequentially, append `ToolMessage`s,
  re-invoke. At `AGENT_MAX_TOOL_STEPS`, one final invoke with tools unbound
  ("wrap up"); `asyncio.timeout(AGENT_TIMEOUT_SECONDS)` wraps the whole
  turn → timeout = apologetic message + failed operation.
- **Context rebuild:** full history replay as Human/AI messages, **body
  only — past tool traffic is not replayed**; active (non-superseded)
  preferences rendered as a structured block inside the system prompt. Full
  replay first; a rolling summary only if token limits actually bite.
- **Capture:** a per-run collector in `ToolContext` (dataclass: `session`,
  `chat`, `collector`) records every executed call into the pinned
  `tool_calls` shape; `retrieve_bike_knowledge` additionally contributes its
  chunks to `sources`; `present_recommendations` args (bike ids/names +
  rationale + matchedPreferences) are resolved against approved models,
  enriched into the pinned snapshot shape, and stored — the tool returns a
  short ack string to the model. **Recommendations-via-tool is the pinned
  choice** over a second structured-output pass (one mechanism, no post-hoc
  parsing).
- Tool registry (8): `catalogue_search`, `spec_comparison`,
  `licence_fit_check`, `cost_estimator`, `retrieve_bike_knowledge`,
  `record_preference`, `flag_unknown_bike`, `present_recommendations`.
- **Write-tool policy (pre-answered so no agent stops on it):** the
  architecture's "write tools stay explicitly permissioned" is satisfied by
  the recorded product decisions — `record_preference`,
  `flag_unknown_bike` (backlog insert via `product_service.create_backlog`,
  deduped across **all** statuses via `DuplicateModelError`) and
  `present_recommendations` are the explicitly permitted low-risk autonomous
  writes. No other write tool may be added without an owner decision.
- Tools call services — **no SQL in tools** (`agent tool → application
  service → database`). Structured output uses the landed 2.17 pattern
  (`method="json_schema"`, every property in `required`, optionality as
  null unions).

---

## Config keys (added to `.env.dist` + `backend/app/core/config.py`)

```text
3.5:  ADVISOR_MODEL=openai/gpt-4.1-mini
3.7:  RRF_K=60 · RETRIEVAL_CANDIDATES_PER_LEG=50
3.13: AGENT_MAX_TOOL_STEPS=8 · AGENT_TIMEOUT_SECONDS=120
```

`ADVISOR_MODEL` drives the advisor (responder + agent loop); `CHAT_MODEL`
stays the ingestion/extraction + utility model (incl. query translation).
No other step adds config. Retrieval `limit=10` stays a function-parameter
default. Cost coefficients are a versioned Python constant
(`cost_data.py`), not config. The chat-message max length (4000) and
`CHAT_TURN_STALE_SECONDS` (150) are schema/module constants, not config.

---

## New dependencies

**None, on either track.** langchain, langchain-openrouter, langchain-openai,
react-markdown, remark-gfm are all already installed. If a step believes it
needs a new dependency, stop and report.

---

## Merge-friction files

`backend/app/core/config.py` · `backend/app/cli/main.py` · `compose.yaml`
(app-worker module list, 3.5) · `frontend/src/queryKeys.ts` ·
`frontend/src/hooks/useServerEvents.ts` ·
`frontend/src/locales/en/translation.json` · the route table in
`frontend/src/App.tsx` (or wherever the landed route table lives).

**Single-Alembic-head rule: only 3.1 carries a migration.**

---

## Frontend conventions — delta

File placement, stub pattern, envelope unwrapping, page walk, and error-type
conventions carry over from Phase 1/2 unchanged. Full component inventory
and layouts: [`ui-spec.md`](ui-spec.md).

**Hook files (pinned — one file per replacement step so stubs die
wholesale):**

| File | Exports | Stubbed in | Made real in |
|---|---|---|---|
| `frontend/src/hooks/useChats.ts` | `useChats()`, `useChat(chatId)`, `useCreateChat()`, `useDeleteChat()` + type `Chat` | 3.4 | 3.6 (deleted wholesale) |
| `frontend/src/hooks/useChatMessages.ts` | `useChatMessages(chatId)`, `useSendMessage(chatId)` + types `ChatMessage`, `MessageSource`, `ToolCall`, `Recommendation`, `ChatError` | 3.4 | 3.6 (deleted wholesale) |

**Query keys** (extend `frontend/src/queryKeys.ts` with builders in 3.4):
`chats.list()` → `["chats", "list"]`, `chats.detail(id)` →
`["chats", "detail", id]`, `chatMessages.byChat(chatId)` →
`["chatMessages", chatId]`; invalidation always targets the sibling prefix.

**Pinned UI-side rules** (details in ui-spec): exactly **one optimistic
update in the app** — the user's own outgoing chat message; typing state
from `activeOperationId` only; `LiveConnectionAlert` extracted from
`AdminLayout` (shared by both layouts; `admin.live.disconnected` moves to
`common.live.disconnected`); `HomeRoute` + `HealthStatus`/`useHealth`
deleted in 3.4 (index route becomes `<Navigate to="/consultations"
replace />`); recommendation cards are non-interactive in Phase 3 with the
`/catalogue/:motorbikeId` href contract reserved for Phase 4; step 3.10
introduces **no stub** — pure presentational components with fixture-prop
tests (the hooks are already real after 3.6).

---

## Landed decisions

Appended by implementing agents when a step finishes — decisions later steps
depend on. 1–3 bullets per step, no prose.

### Step 3.1 (chat persistence)

- **Migration `fb2747f937c4` (`add_chat_tables`) is the new head** (revises
  `485b2042d7f8`) — autogenerated, then hand-reviewed (`id` moved to the front,
  downgrade drops `chat_message_role` + `preference_firmness` explicitly).
  `alembic check` clean, round-trip verified, and the whole chain replayed on a
  fresh database. **No other Phase-3 step may add a migration.** Model
  constants live in `app/db/models/chat.py`: `TITLE_LENGTH = 160`,
  `ATTRIBUTE_LENGTH = 64`, `VALUE_LENGTH = 256`, enums `ChatMessageRole` /
  `PreferenceFirmness`.
- **`chat_service` contract as pinned, plus three things callers must know:**
  every public function commits; `append_user_message` stores `body` **verbatim**
  and truncates it to 160 for the title, so **3.3 must pass an already-stripped,
  already-length-checked body** (the service is not the boundary);
  `list_messages(session, chat_id)` is **unpaginated** by pin, so 3.3 either
  pages in the route or adds `limit`/`offset` there; `_touch(chat)` sets
  `updated_at` explicitly in Python (an unchanged chat row would otherwise skip
  the UPDATE and the server-side `onupdate` entirely, freezing the
  `-updatedAt` list order). `record_preference` generates the ULID itself,
  flushes, then updates the old rows with an `id != new_id` guard — the self-FK
  requires the insert first. `active_preferences` is ordered `created_at ASC,
  id ASC` (stable system-prompt block).
- **Test-harness changes in `tests/services/conftest.py`** (shared fake session,
  so later steps inherit them): `is_`/`is_not` comparisons + `NULL` literals are
  interpreted, `flush()` is a no-op (`add` already stores the row), and a **bug
  fix** — `.asc()` was treated as descending (only `.desc()` sorts descending
  now); no existing service used `.asc()`, so nothing else moved.
- **Operational note for anyone running `alembic downgrade` on the dev stack:**
  a live `GET /api/events` stream holds an idle-in-transaction session with a
  lock on `users`, which blocks `DROP TABLE chats` (FK → `users`) indefinitely.
  Close the browser tab or
  `psql -c "select pg_terminate_backend(pid) from pg_stat_activity where state='idle in transaction'"`
  first.

### Step 3.3 (chat JSON:API endpoints)

- **The frozen message-part schemas live in
  `backend/app/api/schemas/chat_messages.py`**: `ToolCall`, `ToolCallStatus`
  (`succeeded`/`failed`), `MessageSource`, `Recommendation`,
  `RecommendationKeySpecs` (reusing `SpecCategory`/`PriceBand` from
  `schemas/products.py`, so one vocabulary reaches OpenAPI), plus
  `BODY_MAX_LENGTH = 4000`. They are **validated on read**
  (`ChatMessageAttributes.model_validate(row)` over the JSONB columns), so
  **3.13's writers must emit every key of these models, camelCase, including
  `error: null` and `result: {}` on a failed call** — a missing key is a 500 on
  `GET /api/chat-messages`, not a silent gap. `arguments`/`result` stay open
  objects (real-DB round-trip verified verbatim).
- **Seams 3.5 wires** (nothing else in these modules needs to move): in
  `endpoints/chats.py::create_chat`, call `start_response` between
  `chat_service.create_chat` and the existing `await session.refresh(chat)`; in
  `endpoints/chat_messages.py::create_chat_message`, after
  `append_user_message`; both routes then add
  `status.HTTP_409_CONFLICT` to their `jsonapi.error_responses(...)` list and
  the stale-turn healing goes into `_owned_chat_or_404`'s caller, not into the
  ownership helper. Ownership 404 is a per-module helper (`_get_or_404` /
  `_owned_chat_or_404`) wrapping `chat_service.get_owned_chat` — unknown,
  foreign and soft-deleted are one answer, and DELETE inherits it (second
  DELETE → 404).
- **Two contract details 3.6 builds against:** `POST /api/chats` requires the
  full strict envelope `{"data":{"type":"chats","attributes":{}}}` (empty
  attributes object, `extra="forbid"` → 422 for an invented `title`), and
  `chat_service.list_messages` stayed **unpaginated** — the route slices
  `messages[offset:offset+limit]` and reports the full timeline length as
  `meta.totalCount`, so the pinned `createdAt ASC, id ASC` ordering has exactly
  one owner and the page walk still terminates.

### Step 3.4 (chat shell, UI-only)

- **Stub contract 3.6 must preserve verbatim:** `useChats.ts` exports
  `useChats() -> UseQueryResult<Chat[]>`, `useChat(id)`,
  `useCreateChat() -> UseMutationResult<Chat, Error, void>`,
  `useDeleteChat() -> UseMutationResult<void, Error, {chatId}>` + `Chat`
  (`{id, title, activeOperationId, createdAt, updatedAt}`);
  `useChatMessages.ts` exports `useChatMessages(chatId)`,
  `useSendMessage(chatId) -> UseMutationResult<ChatMessage, Error, {body, localId}>`
  + `ChatMessage`/`MessageSource`/`ToolCall`/`Recommendation`/`ChatError`
  (`status` + `code`, `ProductError` shape). `ChatMessage` carries the two
  **client-only** optimistic fields `localId?` and `state?:
  "sending"|"sent"|"failed"`; the server echoes `localId` back as the row `id`,
  which is how a refetch replaces the optimistic entry. `useChats.ts` imports
  `ChatError` + three stub-only helpers from `useChatMessages.ts` (one
  direction, no cycle) — the fixture turn table lives with the timers.
- **Component contracts (written to survive the 3.6 stub deletion):**
  `MessageBubble({message, state?, onRetry?, onDiscard?})` — `state` is the
  **effective** send state resolved by the route (`message.state`, or `"sent"`
  on the newest user message while the turn is in flight), because "seen" is a
  property of the turn, not of the row; 3.10 fills the three marked part slots
  inside the assistant `Paper` (tool blocks → markdown body → cards → sources).
  `TypingIndicator()` and `LiveConnectionAlert()` take no props;
  `LiveConnectionAlert` is rendered **unconditionally** (it owns the status
  read + the 5 s grace) and `AdminLayout` now uses it — `admin.live` is gone,
  `common.live.disconnected` is the key.
- **Route-level decisions:** `MESSAGE_MAX_LENGTH = 4000` and
  `CHAT_TURN_STALE_SECONDS = 150` are module-private constants in
  `ConsultationChatRoute.tsx` (no new shared module; exporting them from a
  route file would trip `react-refresh/only-export-components`); the stale flag
  comes from a local `useTurnIsStale(since)` hook (timer armed for the exact
  remaining moment, verdict *derived* from the last tick — no reset-in-effect)
  because the composer gating needs it at page level, not only in the timeline;
  discarding a failed send is a route-owned `queryClient.setQueryData` on
  `queryKeys.chatMessages.byChat(chatId)`. Deliberate omissions: no part
  renderers (3.10), no `retry` override on the chat queries — so a 404 deep
  link shows the page spinner for ~7 s (TanStack default backoff) before the
  not-found gate, exactly as on the admin review screen. `health.*` i18n keys
  were deleted along with `HealthStatus`.

### Step 3.7 (hybrid retrieval service)

- **`retrieval_service.search(session, query_text, *, motorbike_ids=None,
  limit=DEFAULT_LIMIT) -> list[RetrievedChunk]`** is the only retrieval entry
  point (3.8/3.9/`retrieve_bike_knowledge` call it, never the SQL): signature
  exactly as pinned, `DEFAULT_LIMIT = 10` a module constant, `motorbike_ids=[]`
  and a blank/whitespace query return `[]` **without** a gateway call or a
  statement, and the service commits nothing. It embeds the query itself via
  `llm_embeddings.get_embeddings().aembed_query(...)` — so it raises
  `MissingApiKeyError` (callers report it) and `retrieval_service.
  StaleEmbeddingsError` (wraps `embedding_service.DimensionMismatchError`, its
  message keeps the migration text and adds `app embeddings rebuild`).
  `RetrievedChunk` is a frozen Pydantic model with the pinned provenance set
  (`chunk_id, motorbike_id, text, score, source_document_id, source_url,
  source_title, heading_path, page_number, sequence`) and **snake_case** fields —
  camelCase aliasing for the pinned `sources[]` JSONB shape is 3.13's job.
- **The SQL is one statement built in `_build_statement` and never re-sorted or
  re-filtered in Python:** CTEs `lexical` (`ts_rank` over `text_tsv` +
  `text_tsv @@ plainto_tsquery('english', …)`) and `semantic`
  (`embedding <=> :vector`), each `row_number()`-ranked by its own ordering and
  `LIMIT settings.retrieval_candidates_per_leg`, `FULL OUTER JOIN`ed into
  `fused` with score `coalesce(1.0/(RRF_K+lexical.rank),0)+coalesce(1.0/
  (RRF_K+semantic.rank),0)` cast to double precision, then joined to `chunks` +
  `source_documents` and ordered `score DESC, chunks.id`. Both legs carry all
  four filters (`motorbikes.status='approved'` via a join on `motorbikes`,
  `embedding IS NOT NULL`, `embedding_model = settings.embedding_model`,
  optional `motorbike_id IN`) — a later filter must be added to **both** legs,
  not to the outer select. New config: `RRF_K=60`,
  `RETRIEVAL_CANDIDATES_PER_LEG=50` (unchanged after the tuning pass; with ~49
  embedded chunks the per-leg cap is not yet binding).
- **Test convention for CTE-shaped SQL:** `tests/services/conftest.py`'s
  `FakeAsyncSession` cannot interpret this statement, so
  `tests/services/test_retrieval_service.py` defines a local `RecordingSession`
  (records statements, replays scripted `result.mappings()` rows) and asserts
  the **compiled** SQL (`postgresql.dialect()`, no `literal_binds` — the
  `REGCONFIG` `'english'` argument has no literal renderer; parameters are
  normalised to `?` and checked via `compiled.params`). Reuse that stub for the
  retrieval tool tests instead of extending the fake session. No CLI test file
  (`app retrieval search` touches the DB — the 2.19 precedent); live proof:
  top hit for "comfortable touring bike" scored `0.03279 = 2/(60+1)`, i.e. rank
  1 in both legs, and `--bike <ulid>` returned that model's chunks only.

### Step 3.8 (query translation & spec-filter resolution)

- **`app/llm/query_translation.py` is the one definition of the filter surface**
  (3.9/3.11 import from there, never restate it): `TranslatedQuery`
  (`search_queries` ≤ `MAX_SEARCH_QUERIES = 3`, deduped/trimmed/≤200 chars each ·
  `spec_filters` · `target_motorbike_names` ≤ 5, ≤ `motorbikes.name` length) and
  `SpecFilters` (`categories[]`, `engine_cc_min/max`, `power_kw_min/max`,
  `wet_weight_kg_max`, `seat_height_mm_max`, `a2_eligible`, `price_bands[]`) plus
  `values()` (plain values, enums unwrapped) and `is_empty()` (tested against
  `None`/`[]`, **not** falsiness — `a2_eligible=False` is a constraint).
  `FILTERABLE_SPEC_FIELDS` + `UNFILTERED_SPEC_FIELDS` = exactly `SPEC_FIELDS` and
  `FILTER_FIELD_COLUMNS` maps every filter field → its frozen column; the drift
  guard asserts all three, so a new spec column forces a decision. Units are
  extraction's: `query_translation` imports `_quantity_validator` /
  `_vocabulary_validator` / `_normalize_flag` from `app/llm/extraction.py` rather
  than restating the conversion tables. `ActivePreference(attribute, value,
  firmness)` is the prompt's preference value object (callers map the ORM rows;
  this module stays DB-free); the prompt renders history + preferences as
  optional blocks and fences all of it as untrusted data.
- **New provider finding on the 2.17 pattern (proven live, 3.8):** a **nested**
  object in a `json_schema` response format must carry
  `additionalProperties: false` — without it OpenAI *and* Azure answer 400
  `invalid_json_schema` ("In context=('properties', 'spec_filters'),
  'additionalProperties' is required to be supplied and to be false"). The
  **root** object stays open exactly as 2.17 pinned it. `_require_every_property`
  therefore walks `$defs`, adds every property to `required` everywhere and
  closes nested objects only — Pydantic never calls the nested model's
  `model_json_schema`, and LangChain inlines the `$def` afterwards, carrying
  both. Any later nested structured-output schema needs the same walk.
- **`catalogue_search_service.find_motorbike_ids(session, filters)`** is the
  structured-retrieval entry point (3.11's `catalogue_search` tool reuses it, no
  refactor): one statement, `motorbikes` ⨝ `motorbike_specs` with
  `status='approved'` + `kind='verified'` + one clause per stated bound (minima
  `>=`, maxima `<=`, vocabularies `IN`, `a2_eligible IS true/false`), ordered
  `motorbikes.name, motorbikes.id`, ids only, nothing committed, no Python-side
  post-filter. **A bike whose verified spec value is `NULL` never matches a
  filter on that column** (SQL three-valued logic, deliberate: a filter is a
  claim, and the project never guesses a spec to keep a bike in the list); an
  empty `SpecFilters` matches every approved bike **that has a verified spec**
  (inner join). Tests follow 3.7's convention — a local `RecordingSession` +
  compiled-SQL assertions, since `FakeAsyncSession` cannot interpret the join.

### Step 3.5 (minimal chat responder job)

- **The seam trio, names 3.13 must keep:**
  `chat_response_service.generate(session, chat, operation)` (system prompt
  `advisor_system.md` rendered with the single variable **`is_opening`** =
  empty timeline, then the full history as Human/AI messages body-only, one
  `get_chat_model(settings.advisor_model).ainvoke`, persisted through
  `append_assistant_message`; a blank answer raises
  `chat_response_service.EmptyAnswerError` instead of storing an empty bubble),
  `chat_service.start_response(session, chat) -> Operation` (operation →
  pointer + `_touch` → commit → `enqueue_chat_response`, the 2.14 seam;
  autouse `recorded_chat_enqueues` in `tests/conftest.py`), and
  `chat_service.get_chat(session, chat_id)` — the **worker's** loader
  (live chat, no ownership check; routes keep `get_owned_chat`). Constants:
  `chat_service.RESPONSE_OPERATION_TYPE = "chat.response"`,
  `operation_service.CHAT_ENTITY_TYPE = "chat"`,
  `chat_service.STALE_TURN_SECONDS = 150` (module constant with a TODO naming
  3.13), `chat_service.TIMED_OUT_ERROR = "Response timed out."`.
- **Healing runs *before* `append_user_message`, not after** (step-file order
  reversed on purpose; shared-knowledge's "accept the message" wins): a 409
  must leave nothing behind, because an in-flight turn built its context before
  the request arrived, so a message stored next to it would never be answered.
  `heal_stale_turn(session, chat) -> bool` owns the whole matrix (terminal /
  vanished operation / older than 150 s → clear, `True`; else `False`) and the
  route turns `False` into `409 response-pending`. **Only
  `POST /api/chat-messages` documents 409** — `POST /api/chats` cannot produce
  it (contrary to 3.3's note), so its `responses=` list stayed untouched.
- **The trap in `chat.respond`'s failure path, live-found:**
  `await session.rollback()` **expires every ORM instance**, so the apology
  path may not touch the `chat`/`operation` objects it was holding — reading
  `chat.id` after the rollback is implicit IO (`MissingGreenlet`), which cost
  the customer the apology and left the operation `running`.
  `_apologize(session, chat_id, operation_id, error)` therefore takes **ids**
  and re-loads both rows (chat first, operation last, so a second rollback
  cannot re-expire it). Any post-rollback bookkeeping in a future job must do
  the same. Transient set: `TRANSIENT_GATEWAY_ERRORS =
  (EdgeNetworkTimeoutResponseError, RequestTimeoutResponseError)` from
  `openrouter.errors` — timeouts only, everything else becomes the apology
  (`job.APOLOGY`) + `failed`; the job does **not** re-raise after apologising.

### Step 3.6 (chat wired live, S1 closed)

- **Optimistic reconciliation is pinned** (ui-spec §3.2 left it open): the
  server does not echo `localId`, so `useChatMessages`' `queryFn` merges the
  fetched pages with the cached rows whose `state` is `"sending"` or
  `"failed"` (`withUnsentEntries`) and drops everything else — a *confirmed*
  optimistic entry is already in the fetched list, while a failed one holds
  text the user typed and must survive the refetch an arriving advisor reply
  triggers. Consequence for later steps: **anything that writes client-only
  rows into `["chatMessages", chatId]` must mark them `sending`/`failed`, or a
  refetch will silently drop them.** A 409 `response-pending` takes the same
  failed-bubble path (retry/discard is the only way not to lose the text) and
  *additionally* invalidates `["chats"]` — that is the "quiet refetch", there
  is no snackbar.
- **Hook shapes as generated, no hand-written types:** `Chat = {id} &
  ChatAttributes`; `ChatMessage = {id} & ChatMessageAttributes & {localId?,
  state?}`; `MessageSource`/`ToolCall`/`Recommendation` are now
  `components["schemas"][…]` re-exports (so 3.10's renderers get
  `RecommendationKeySpecs`, `SpecCategory` and `PriceBand` typed from the
  backend enums, and `toolCalls[].arguments/result` stay open objects).
  `ChatError` + the builder `chatError(status, body)` live in
  `useChatMessages.ts`; `useChats.ts` imports the builder from there (one
  direction, no cycle). `PAGE_SIZE = 100` page walk inlined in both list
  hooks; `DELETE /api/chats/{id}` treats 404 as success.
- **`useServerEvents` now has a payload-conditional layer:** the static
  `INVALIDATIONS` map gained `chat.message.created →
  ["chatMessages"] + ["chats"]`, and `conditionalInvalidations()` parses
  `event.data` (`entityTypeOf`) to add `["chats"]` on `operation.updated`
  with `entityType === "chat"` — the only event payload this app reads.
  Reconnect blanket = products, operations, chats, chatMessages. **Test
  convention:** mutation-driven cache changes are only visible in
  `renderHook` results inside `waitFor`, and a stubbed request resolves in the
  same tick as the keystroke, so the `sending` state needs a released gate
  promise (`holdNextPost()` in `ConsultationChatRoute.test.tsx`) — reuse both
  in 3.15.

### Step 3.9 (RAG pipeline service)

- **`rag_pipeline_service.retrieve(session, utterance, *, preferences=(),
  history_summary="", limit=retrieval_service.DEFAULT_LIMIT) -> RagResult`** is
  the whole pipeline and the only thing 3.13's `retrieve_bike_knowledge` may
  call. `RagResult` is a frozen Pydantic model with exactly the four pinned
  fields, **snake_case** (`queries`, `applied_filters`,
  `candidate_motorbike_ids`, `chunks`); `applied_filters` holds **only the
  stated bounds** as plain values (`SpecFilters.values()` minus `None`/`[]`), and
  `chunks[].score` is the **cross-query** RRF score (`model_copy` replaces the
  per-query one), comparable only inside one result. Candidate order is
  **resolved names first, then the filter matches** (merged, not intersected).
  Nothing is committed; `preferences` is `Sequence[ActivePreference]`.
- **Three degradation rules 3.13 must not re-implement:** a failed *or* empty
  translation → raw utterance, no filters, unscoped (logged once, never raised);
  `candidate_motorbike_ids == []` **with** non-empty `applied_filters` means the
  constraints match no approved model and **no search is issued at all** (empty
  `chunks` is the honest answer — widening would cite bikes the customer ruled
  out), while `[]` with empty filters means unscoped; `retrieval_service`'s two
  configuration errors (`MissingApiKeyError`, `StaleEmbeddingsError`) **do
  propagate** — the tool wrapper turns them into a `failed` tool_call entry.
  Name resolution is a private `_resolve_names` (slug via
  `product_service.get_by_slug`, approved-only, unresolvable names skipped) —
  **3.11's `catalogue_search_service.resolve_name` should replace it**, it is the
  first call site.
- **Live finding (open, environmental):** the fan-out issues one embeddings
  request per rewritten query and `app/llm/embeddings.py` sets **no request
  timeout**, so a stalled OpenRouter embeddings call hangs the caller for the
  openai-SDK default (~600 s). Reproduced 7/7 for the utterance *"What do
  reviewers say about the Suzuki GSR600?"* via `app rag ask` (3rd `POST
  /embeddings` sent, no response, no DB wait; identical calls from a script
  harness and every other utterance probed pass in 7–10 s). The pinned
  verification utterance is unaffected (3/3 green). 3.13's
  `asyncio.timeout(AGENT_TIMEOUT_SECONDS)` covers the production path; adding a
  client-side timeout would touch `llm/embeddings.py` (outside 3.9) — owner call.
  Note for anyone probing the CLI: a `timeout`-killed `docker compose exec` leaves
  the process **alive inside app-web** holding an idle-in-transaction session —
  kill them (`/proc` scan) or the pool fills up.
