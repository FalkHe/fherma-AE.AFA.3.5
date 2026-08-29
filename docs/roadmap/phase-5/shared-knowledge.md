# Phase 5 — Shared Knowledge (binding contract)

This document is the **single source of truth** for every Phase-5 step. Every
agent working on a Phase-5 step must read it fully before writing code. When a
step file and this document disagree, this document wins. Do not deviate from
anything pinned here — if a deviation seems necessary, stop and report it
instead of improvising, because a parallel agent is building against the same
contract.

UI audit/state details live in [`ui-spec.md`](ui-spec.md) (binding for
frontend steps, written at slicing time by the ui-ux-designer). Phase-1/2/2b/3/4
conventions ([`../phase-1/shared-knowledge.md`](../phase-1/shared-knowledge.md),
[`../phase-2/shared-knowledge.md`](../phase-2/shared-knowledge.md),
[`../phase-2b/shared-knowledge.md`](../phase-2b/shared-knowledge.md),
[`../phase-3/shared-knowledge.md`](../phase-3/shared-knowledge.md),
[`../phase-4/shared-knowledge.md`](../phase-4/shared-knowledge.md), each
including its Landed decisions) continue to apply — in particular the
error-shape split (D1 below restates it), the JSON:API layer
(`app/api/jsonapi.py`), the operations lifecycle, the Taskiq patterns
(`TransientJobError` is the only retried exception), the stale-turn healing
matrix, and every frontend hook/queryKeys/EmptyState/skeleton convention.

**Scope note (2026-08-28):** the former effort-8 steps 5.1–5.3 were split into
steps 5.4–5.18 (this document + the step files). `step-5.1.md`, `step-5.2.md`
and `step-5.3.md` remain as mapping markers only. **This phase is hardening,
not feature work**: the SSE reconnect indicator, per-screen
empty/loading/error states, ingestion failure semantics, the chat-job apology
path and tool-argument bounds are already landed and pinned — no step rebuilds
them; steps confirm, test, and close the audited gaps listed here.

---

## Hard rules for every Phase-5 step

- **Zero migrations.** Alembic head stays `fb2747f937c4`. A schema need is a
  stop-and-report. (This also rules out the old 5.1 outline's "per-stage
  failure recording on the operation row" — see D2 resolution.)
- **New dependencies: exactly one, backend, in step 5.9** — `langfuse`.
  Anything else (either track) is stop-and-report. Frontend adds **zero**
  dependencies: no notistack, no rehype-raw — ever.
- **New config keys: exactly three, in step 5.9** — `LANGFUSE_PUBLIC_KEY`,
  `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`, all optional with default `None`/`""`,
  added to `backend/app/core/config.py` and `.env.dist` together. LLM client
  timeouts (D3) are module constants, **not** settings.
- **Q4 / OQ4 (concurrent-turn 409 race) is out of scope.** It stays a
  documented known issue (README limitations, 5.15; recorded in Phase-3/4
  open-questions). No Phase-5 step touches the `POST /api/chat-messages` path.
- **The env template is `.env.dist`** — the old step-5.3 wording
  ".env.example" is superseded; README, compose.yaml and `.env.dist` itself
  already reference `.env.dist`.
- **`docker compose restart app-worker`** is required after landing 5.6, 5.8
  and 5.9 (they change job-executed code — the 2b.4 operational pin).
- **Live verifications need the stack up** (`make up`); `OPENROUTER_API_KEY`
  and `TAVILY_API_KEY` are configured in the dev `.env` and live-verified in
  earlier phases.

---

## Parallel-run rule

Two tracks run **concurrently**. Backend agents never touch `frontend/`;
frontend agents never touch `backend/`. Frontend steps 5.12 and 5.13 need
**zero backend code**; 5.14's type regeneration consumes merged backend work,
it does not modify it.

```text
backend-dev:  5.4 ─► 5.5 ─► 5.6 ─► 5.7 ─► 5.8 ─►║M1║─► 5.9 ─► 5.10 ─►║M2║─► 5.11 ─►║S2║
frontend-dev: 5.12 ─► 5.13 ─► ║S1║ 5.14 ────────►║M1║
docs-writer:                                                             ║S2║─► 5.15 ─► 5.16
qa:                                     5.17 (after M1, both tracks)                5.18 ─► tag phase-5-done
```

**Cross-track sync points:**

- **S1** — step 5.14 starts only after backend **5.5** is merged (it refreshes
  the generated API types once, via the landed image-independent sequence:
  `make generate-api`). No wire-shape change is expected — the refresh is a
  consistency check plus commit of the artifact.
- **S2** — docs steps 5.15/5.16 start only after backend **5.11** is merged
  (seed contract and Langfuse behaviour must be final before being
  documented).

Within-track: 5.6/5.7 have no code dependency on 5.4/5.5 — an optional second
backend session may run 5.6→5.7→5.8 concurrently with 5.4→5.5
(merge-friction files at the bottom; `llm/models.py` is the file to watch).
5.11 depends only on 5.6 and may likewise run parallel to 5.9/5.10.

---

## Milestones (commit & tag points)

**Commit rule:** one commit per finished step (its verification green — lint,
types, tests). **Milestone rule:** a milestone is reached when all its steps
are merged on both tracks and its demo criterion passes; tag it
(`phase-5-m<N>`). Do not start a later milestone's steps before the earlier
milestone's demo passes (exception: 5.9's compat spike may run any time).

| Milestone | Steps (backend ∥ frontend) | Demo criterion (both tracks together) |
|---|---|---|
| **M1 — Hardened core** | 5.4–5.8 ∥ 5.12–5.14, then QA 5.17 | Garbage/oversized payloads answer the pinned 422/400 shapes; a forced 500 answers the JSON:API envelope with no traceback; an invalid `OPENROUTER_API_KEY` surfaces the apologetic failure state in the UI within the client timeout (never a 600 s hang, never a stuck "typing…"); a poisoned ingested document is neutralized (advisor does not comply); `<script>`/`<img onerror>` render inert on chat, model detail and admin review; a forced render crash shows the `AppErrorBoundary` fallback. Tag `phase-5-m1`. |
| **M2 — Observability** | 5.9, 5.10 (backend only) | `docker compose --profile langfuse up` starts the Langfuse stack and one consultation shows a full trace (agent steps + tool calls) in the Langfuse UI; plain `docker compose up` starts exactly today's services; with `LANGFUSE_*` unset the app behaves byte-identically; a wrong `LANGFUSE_HOST` never fails a chat. Tag `phase-5-m2`. |
| **M3 — Submission ready** | 5.11 ∥ 5.15 → 5.16, then QA 5.18 | Fresh clone + `.env` from `.env.dist` → README followed verbatim → seeded catalogue (≥ 10 approved models) → full demo walkthrough green; `docs/grading-map.md` maps every criterion and bonus to real files/endpoints/screens. Tag `phase-5-done`. |

---

## Environment prerequisites

- **`phase-4-done` tagged** — satisfied (verified 2026-08-28).
- **Working tree clean** — the stray CORS tweak in `backend/app/main.py`
  was committed as a standalone chore at slicing end (resolved A1, see
  [`open-questions.md`](open-questions.md)); 5.4 may dispatch.
- The Phase-4 demo data (3 approved models with **guessed** prices — Phase-4
  OQ2) still stands; 5.15/5.16 must not present those values as verified.

---

## Design decisions — final (recorded 2026-08-28)

- **D1 — 500 catch-all (5.4):** one `Exception` handler registered in
  `backend/app/main.py` **beside** the existing `JsonApiError` handler — the
  Phase-2 "handler registered once in main.py" pin wins over the old 5.1
  outline's `api/errors.py` (**no new module**). Response: JSON:API
  `ErrorDocument`, status 500, code **`internal-error`**, a generic detail
  sentence, nothing derived from the exception; the traceback goes to
  `logger.exception` only. Everything else in the pinned error-shape split is
  unchanged: request/body validation keeps FastAPI's default 422
  `{"detail":[{"loc":…}]}`, auth/CSRF deps keep `{"detail": "…"}` 401/403,
  domain failures keep their JSON:API codes. The frontend needs **zero
  changes** for this (it branches on status + code and already renders
  `common.errors.serverError` generically; envelope `detail` text stays
  unrendered).
- **D2 — validation close-list (5.5), exhaustive:** (1) member-count and
  per-member length caps in `jsonapi.parse_filter` (violation → 400
  `invalid-filter`); (2) `ge`/`le` plausibility bounds on the catalogue
  numeric filter query params, mirroring the `SpecFilters` ranges; (3) an
  upper bound on `page[number]` in the shared pagination dependency; (4) a
  ULID-shape constraint on `ChatMessageCreateAttributes.chat_id`; (5) size
  caps on `DraftSpecRequest.extra` / `source_hints`; (6)
  `LoginRequest.password` gains `max_length=1024` — **owner-approved
  2026-08-28 (OQ-A), a sanctioned relaxation of the Phase-1 "login
  deliberately unvalidated" pin**: the bound exists solely to cap Argon2 work
  per attempt; violation → default 422; username stays unvalidated beyond
  normalisation, and no other login rule is added. **Pinned as-is, do not
  touch:** `page[size]` (already capped at 100), every tool args schema
  (already bounded), and the ingestion warning policy ("a partial failure is
  a warning, never a failure" — Phase-2 pin; stage milestones, retry button
  and abandon-to-backlog already cover failure states, so the old outline's
  per-stage recording is dropped, not deferred).
- **D3 — LLM client policy (5.6):** explicit `timeout` + `max_retries` on
  both factories in `backend/app/llm/models.py` and
  `backend/app/llm/embeddings.py`, as module constants:
  `CHAT_REQUEST_TIMEOUT_SECONDS = 60`, `EMBEDDINGS_REQUEST_TIMEOUT_SECONDS =
  30`, `LLM_MAX_RETRIES = 2`. The OpenAI SDK's timeout/connection exception
  types join `TRANSIENT_GATEWAY_ERRORS` in `backend/app/jobs/chat.py`, so a
  gateway timeout retries through the **single global retry budget**
  (`SmartRetryMiddleware`, 3 attempts, exponential + jitter) — no per-call-site
  tuning anywhere. This closes the step-3.9 open finding (stalled embeddings
  call hung ~600 s); `llm/embeddings.py` was out of scope then, in scope now.
  **Amendment (2026-08-29, coordinator, after the 5.6 SDK verification):** the
  units differ per factory and the constants above state *seconds*, so the
  chat call site converts. `langchain_openrouter.ChatOpenRouter`'s `timeout`
  field is **milliseconds** (`request_timeout` → the SDK's `timeout_ms`), so
  pass `timeout=CHAT_REQUEST_TIMEOUT_SECONDS * 1000` with a comment naming the
  unit; `OpenAIEmbeddings.timeout` is seconds and takes the constant directly.
  Also: `ChatOpenRouter` maps `max_retries` to `max_elapsed_time =
  max_retries * 150 s`, so `LLM_MAX_RETRIES = 2` is a ~300 s *budget ceiling*,
  not "2 × 60 s" — it is bounded in practice by the pre-existing
  `asyncio.timeout(AGENT_TIMEOUT_SECONDS)` (120 s) around the whole turn in
  `app/llm/agents/advisor.py`, which still resolves into the apology path.
  `LLM_MAX_RETRIES = 2` stays pinned; the arithmetic wording is corrected, the
  values are not tuned.
- **D4 — fencing (5.7 + 5.8):** `backend/app/llm/fencing.py` becomes the one
  definition site for `FENCE_START`/`FENCE_END`, the lookalike stripper and a
  `fence(text)` helper (moved verbatim from `extraction.py`, which re-imports;
  extraction wire behaviour unchanged — 5.7 is the pure refactor, its own
  step). 5.8 applies the fences to **exactly three surfaces**: each retrieved
  chunk's text in `retrieve_bike_knowledge`'s tool payload, the preference
  values interpolated into `advisor_system.md`, and the context blocks in
  `query_translation.md` — plus prompt prose stating the sentinel rule,
  matching `spec_extraction.md`'s existing pattern. Nothing else changes in
  the agent loop; step limits (`AGENT_MAX_TOOL_STEPS`, `AGENT_TIMEOUT_SECONDS`)
  and tool-arg bounds are confirmed by tests, not rebuilt.
- **D5 — Langfuse callback factory (5.9):**
  `observability_callbacks(settings) -> list[BaseCallbackHandler]` in
  `backend/app/llm/models.py` returns `[CallbackHandler(...)]` iff **all
  three** `LANGFUSE_*` keys are set, else `[]` (the slot and its docstring
  already exist). Chat-model call sites already consume the factory — no
  call-site changes. **Embeddings are excluded**: LangChain embeddings emit no
  callback events; this is a documented limitation (grading map names it),
  superseding the old 5.2 outline's "embeddings" bullet. A handler/Langfuse
  outage must never fail an LLM call (verify with a wrong `LANGFUSE_HOST`).
  `tests/llm/test_models.py::test_no_callbacks_until_langfuse_is_wired` is
  rewritten. **First action of 5.9 is a compat spike** (langfuse SDK v3 vs
  langchain 1.3.17 / langchain-core 1.6.0, in the app-cli container).
  **Owner decision 2026-08-28 (resolved OQ-B/OQ-C): Langfuse is
  nice-to-have, not cared about** — if the spike fails or 5.9/5.10 stall,
  the coordinator drops them without going back to the owner (M2 collapses,
  the grading map drops the logging/monitoring bonus claim, 5.15's Langfuse
  section is omitted); no fallback engineering (no SDK pinning hunts, no
  cloud-only rework) is spent on it. The only permitted pytest-config change
  is a `filterwarnings` ignore **scoped to langfuse deprecation warnings**,
  and only if the suite forces it.
- **D6 — Langfuse Compose profile (5.10):** profile `langfuse` in
  `compose.yaml` with `langfuse-web`, `langfuse-worker`, `clickhouse`,
  `valkey`, `minio`, and a **dedicated `langfuse-postgres`** service (simpler
  and safer than an initdb script on the shared postgres, whose existing
  volume would never re-run init anyway). Plain `docker compose up` must start
  **exactly today's services** — the default stack stays byte-identical.
  Comment-only additions to `.env.dist`. This is a bonus item: submission
  never depends on it running, and the owner has pre-authorized dropping it
  (or all of Langfuse) on any friction — see D5 (resolved OQ-B/OQ-C).
- **D7 — seed (5.11):** `app seed demo [--auto-approve]`; curated list of
  ~12 models (A2 beginners, tourers, nakeds) at
  `backend/app/cli/data/seed_models.json`; **same ingestion pipeline, no
  bypass**; **skips any model whose slug already exists in any status**
  (the Phase-2b fresh-run pin: re-ingestion deletes documents/embeddings, so
  the seed must never re-ingest); sequential, per-model report-and-continue
  (a flaky model never aborts the seed); `--auto-approve` = the **standard
  transition service** (`in_review → approved`, promoting draft → verified) —
  never a direct status write; exit code 1 only if every model failed.
- **D8 — docs (5.15/5.16):** README is **extended, not rewritten** (the
  landed quickstart stands); demo material **extends
  `docs/demo-walkthrough.md`** (the 4.10 landed decision — no
  `demo-script.md` is created) and the existing chapters become
  **count-agnostic/seed-aware** (they currently hard-code 3 approved models
  with literal ULIDs, which the seed invalidates); `docs/grading-map.md` is
  new. The limitations section covers at least: residual prompt-injection
  risk, no token streaming, English-only, no rate limiting, the Q4
  concurrent-turn race (known open issue, OQ4), guessed demo prices
  (Phase-4 OQ2), Langfuse excludes embeddings (D5), re-embed jobs invisible
  in the UI (ui-spec §3.7).
- **D9 — frontend (5.12/5.13):** [`ui-spec.md`](ui-spec.md) is binding. The
  landed **per-screen EmptyState + refetch pattern stays pinned** — it
  supersedes the old outlines' "error middleware → snackbars" and "TanStack
  Query error boundaries" bullets (ui-spec §9). The shared markdown renderer
  is **`UntrustedMarkdown`** (`frontend/src/components/UntrustedMarkdown.tsx`,
  ui-spec §4): raw HTML off always, no plugin props exposed (no call site can
  ever add rehype-raw), site-specific deltas (heading demotion, table
  overflow wrapper) stay module-local so rendering is byte-identical. One
  **class-based `AppErrorBoundary`** around `<App />` inside the providers
  (ui-spec §5) — render crashes only, never query errors. Gap closures per
  ui-spec §3: backlog transition error Snackbar (a scoped supersession of the
  Phase-2 "SSE shows the outcome" pin — HTTP failures only, success stays
  surface-free), review tab panels own their query loading/error states,
  operations-query failure warning Alert on the backlog. **Pinned deliberate
  silences stay silent:** logout failure, re-embed operations (CLI is the
  progress surface), LiveConnectionAlert absent on catalogue screens. New
  i18n keys are exactly the six in ui-spec §6. No keystroke validation
  (standing pin).

---

## Merge-friction files

Backend: `backend/app/main.py` (5.4, plus the pre-dispatch CORS chore) ·
`backend/app/llm/models.py` (5.6 **and** 5.9 — sequence them or coordinate) ·
`backend/app/core/config.py` + `.env.dist` (5.9, 5.10) · `compose.yaml`
(5.10) · `backend/app/cli/main.py` (5.11) · `backend/pyproject.toml` +
`uv.lock` (5.9; run `make build` after so the CLI images pick it up).

Frontend: `frontend/src/locales/en/translation.json` (5.13) ·
`frontend/src/main.tsx` (5.13, boundary mount) · the three markdown sites
(`MessageBubble.tsx`, `CatalogueModelRoute.tsx`, `ModelDocumentsPanel.tsx` —
all 5.12).

Docs: `README.md` (5.15) · `docs/demo-walkthrough.md` (5.16).

**Single-Alembic-head rule: no Phase-5 migration at all.**

---

## Landed decisions

Appended by implementing agents when a step finishes — decisions later steps
depend on. 1–3 bullets per step, no prose.

### Step 5.4

- `app.main.unhandled_exception_handler` registered via
  `app.add_exception_handler(Exception, unhandled_exception_handler)`, right
  after the existing `JsonApiError` handler — no new module, matches D1
  exactly. Response body is always `jsonapi.error_document(500,
  "internal-error", INTERNAL_ERROR_DETAIL)` with `INTERNAL_ERROR_DETAIL = "An
  unexpected error occurred."` (a `main.py` module constant); `logger =
  logging.getLogger(__name__)` in `main.py` (matches the `logging.getLogger`
  convention used elsewhere), `logger.exception(...)` fires before the
  response is built, so 5.17's forced-500 check can assert on the log line if
  needed.
- Verified under `TestClient(app, raise_server_exceptions=False)`: a bare
  exception raised deep in a dependency (not just a route body) still reaches
  this handler and yields the pinned envelope with nothing exception-derived
  in `detail`; FastAPI's default 422 `{"detail":[...]}` shape is unaffected
  (`backend/tests/api/test_error_handling.py`).

### Step 5.12

- `UntrustedMarkdown` (`frontend/src/components/UntrustedMarkdown.tsx`) is
  the single shared renderer, final prop surface: `{ children: string;
  components?: Components; sx?: SxProps<Theme> }` — no `remarkPlugins`/
  `rehypePlugins` prop, ever. Base `a` is `ExternalLink` (module-local, not
  exported); site `components` merge over it (`{ a: ExternalLink,
  ...components }`), so overriding `a` from a call site is possible in theory
  but no site does it. `BASE_MARKDOWN_SX` is exactly the ui-spec §4.2
  intersection (`table`/`th,td`/`pre`/`a`); each site keeps its own sx/
  components delta as a module constant merged via the `sx` prop (MUI array
  form `[BASE_MARKDOWN_SX, ...sx]`).
- `MessageBubble`, `ModelDocumentsPanel`, `CatalogueModelRoute` all migrated;
  `ProseTable`/`ProseHeading3`/`ProseHeading4` stay in `CatalogueModelRoute`
  (catalogue-only heading demotion, P4 §4.4). Rendering is byte-identical —
  no visual/DOM diff versus the pre-migration configs.
- Added `UntrustedMarkdown.test.tsx` (inertness, link attrs, GFM table,
  `components` override merge) and the missing `MessageBubble` raw-HTML
  inertness test; all three pre-existing per-site inertness tests
  (catalogue, admin documents) stay green unchanged.

### Step 5.13

- `AppErrorBoundary` (`frontend/src/components/AppErrorBoundary.tsx`) mounted
  in `main.tsx` around `<App />`, inside all providers. Fallback is a
  module-local `ErrorFallback` function component (uses `useTranslation`)
  rendered by the class boundary's `render()`. Fallback aria/role: `EmptyState`
  renders an `h2` (`common.errors.crashTitle` = "Something went wrong"); the
  reload button's accessible name is `common.errors.crashReload` = "Reload
  page" and calls `window.location.reload()` directly (no confirm step). QA
  can force a crash with a component that throws during render (see
  `AppErrorBoundary.test.tsx`'s `Bomb` helper) — there is no dev-flag/query-param
  trigger wired into the shipped app, so a forced-crash walkthrough needs a
  temporary local edit (e.g. a component that throws) or the equivalent
  browser devtools override; nothing production-reachable trips it.
- Gap (a): `AdminBacklogRoute`'s transition-error `Snackbar` — accessible name
  of the dismiss control is the MUI `Alert` default `"Close"`; message text is
  `admin.backlog.transitionError`. Gap (c): the operations-warning `Alert`
  (`severity="warning"`, `sync_problem` icon) renders between the toolbar and
  the table only when `operations.isError`; its retry button's accessible
  name is `common.retry` ("Try again"); message is
  `admin.backlog.operationsLoadError`.
- Gap (b): `ModelDocumentsPanel`/`ModelImagePanel` loading spinner is
  `role="status"` with accessible name `common.loading` ("Loading"); error
  branch is `EmptyState` with `admin.review.documents.loadError` /
  `admin.review.image.loadError` and a `common.retry` button that calls the
  panel's own `query.refetch()`.
- Test-infra note for reproducing gap (b)/(c) in new tests: `useQuery`'s
  default retry budget (3 attempts, exponential backoff) means a *real*
  stubbed-fetch failure through `renderWithProviders`'s default `QueryClient`
  does not reach `isError` inside a `findByText` default timeout. Both
  `AdminBacklogRoute.test.tsx` (operations query) and
  `AdminModelReviewRoute.test.tsx` (documents/image queries) therefore wrap
  the hook with `vi.mock` and an override variable — same idiom as
  `CatalogueRoute.test.tsx`'s `listOverride` (call the real hook, splice in
  `{ ...result, ...override }` only when an override is set) — rather than
  driving the failure through the fetch stub. A mutation's default retry is 0,
  so the gap (a) Snackbar test drives a real stubbed 500 directly, no
  override needed.

### Step 5.6

- Implemented per the D3 amendment exactly: `backend/app/llm/models.py` passes
  `timeout=CHAT_REQUEST_TIMEOUT_SECONDS * 1000, max_retries=LLM_MAX_RETRIES`
  to `ChatOpenRouter` (ms conversion, commented at the call site);
  `backend/app/llm/embeddings.py` imports `LLM_MAX_RETRIES` from `llm.models`
  and passes `timeout=EMBEDDINGS_REQUEST_TIMEOUT_SECONDS, max_retries=` the
  same (seconds, no conversion — `OpenAIEmbeddings` uses the OpenAI SDK's own
  convention). `backend/app/jobs/chat.py`'s `TRANSIENT_GATEWAY_ERRORS` gained
  exactly `openai.APITimeoutError` and `openai.APIConnectionError` (verified
  against installed `openai==2.54.0`; `APITimeoutError` subclasses
  `APIConnectionError`) alongside the existing `openrouter.errors` pair.
- **5.17 note:** the added `openai.*` pair is currently unreachable from
  `chat.respond` in practice — `app/llm/agents/advisor._run_call` catches
  *every* exception from a tool call (including the `retrieve_bike_knowledge`
  tool's `OpenAIEmbeddings.aembed_query`) and turns it into an error
  `ToolMessage`, never letting it propagate to the job. Only a top-level
  `ChatOpenRouter.ainvoke()` failure (which raises `openrouter.errors.*`,
  already covered) reaches `jobs/chat.py`'s except clause today. So 5.17
  cannot provoke a `TransientJobError` via a dead embeddings gateway through
  the live chat path — only via a directly-raised `openai.APIConnectionError`/
  `APITimeoutError` (unit-tested in `tests/jobs/test_chat.py`) or via a
  blackholed/invalid-key `ChatOpenRouter` call (live-verified below). This is
  scope-accurate per the outline, not a gap I introduced or was asked to close.
- Live-verified with the dev `.env`'s real `OPENROUTER_API_KEY` swapped for an
  invalid one (`docker compose up -d app-worker` — **not** `restart`, which
  does not reread `env_file` changes) and a real chat turn driven through
  `POST /api/chats` + polling `GET /api/chats/{id}`: the turn ended in ~1 s
  with `operations.error = "UnauthorizedResponseError: User not found."`,
  `status = failed`, and the stored assistant message was `job.APOLOGY` — the
  fast (auth-rejection) path the step file names as an acceptable alternative
  to a blackholed upstream. Key restored and `app-worker` recreated again
  afterwards; a normal turn was re-verified end-to-end.

### Step 5.5

- Exact constants landed (5.17 asserts, 5.14 regenerates types against
  these): `jsonapi.MAX_FILTER_MEMBERS = 50`, `jsonapi.MAX_FILTER_MEMBER_LENGTH
  = 128` (violation → existing 400 `invalid-filter`, raised by `parse_filter`
  itself now, not only its vocabulary callers); `jsonapi.MAX_PAGE_NUMBER =
  10_000` (`page[number]` `le`, shared `pagination()` dependency — every
  paginated endpoint inherits it); catalogue numeric filters
  (`filter[engineCcMin/Max]`, `filter[powerKwMin/Max]`,
  `filter[wetWeightKgMax]`, `filter[seatHeightMmMax]`) got `ge`/`le` imported
  straight from `app.llm.extraction._QUANTITIES` (`engine_cc` 25–3000,
  `power_kw` 0.5–400, `wet_weight_kg` 30–600, `seat_height_mm` 400–1200) —
  both ends applied to both the min- and max-named params, values restated
  nowhere; `ChatMessageCreateAttributes.chat_id` gained
  `min_length=max_length=ULID_LENGTH` (26, imported from
  `app.db.models.base`) plus `pattern=CHAT_ID_PATTERN =
  r"^[0-9A-HJKMNP-TV-Z]+$"` (uppercase Crockford base32, matching
  `new_ulid`'s canonical output — lowercase is rejected, not folded);
  `DraftSpecRequest.extra`/`source_hints` share one `@field_validator`
  enforcing `DRAFT_SPEC_EXTRA_MAX_KEYS = 50`,
  `DRAFT_SPEC_EXTRA_KEY_MAX_LENGTH = 64`,
  `DRAFT_SPEC_EXTRA_VALUE_MAX_LENGTH = 2_000` (value length measured via
  `json.dumps(item, default=str)`); `LoginRequest.password` gained
  `LOGIN_PASSWORD_MAX_LENGTH = 1024` as a field override on the subclass
  (`_CredentialsRequest.password` stays unconstrained for `RegisterRequest`'s
  own 8–128 rule).
- `parse_filter` now raises `JsonApiError` itself (previously only its
  vocabulary-checking callers did) — every one of its six call sites
  (catalogue-models, chat-messages, documents, images, operations, products)
  inherits the two new caps for free; no call site changed.
- OpenAPI diff reviewed (`app openapi export`, not written into `frontend/` —
  left in `backend/`'s own working tree only, per the no-`frontend/`-touch
  rule): additive only — `minLength`/`maxLength`/`pattern` on `chatId`,
  `maxLength` on `LoginRequest.password`, `minimum`/`maximum` on the six
  catalogue numeric filter params and on every `page[number]` parameter
  (all list endpoints share the one dependency); no field removed, renamed or
  retyped, no endpoint shape change. `parse_filter`'s caps and the
  `extra`/`source_hints` validator are runtime-only and do not appear in the
  schema (a `field_validator`'s `ValueError`, not a `Field` constraint) —
  5.14/5.17 should not expect to find them there.
- Deliberate non-change: `SpecFilters` itself (the LLM-facing schema in
  `app.llm.query_translation`) is untouched — it still silently drops an
  out-of-range bound (the 4.4 caveat); only the catalogue-models wire params
  gained explicit `ge`/`le`.
