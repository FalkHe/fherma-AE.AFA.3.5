# Implementation Roadmap — Motorcycle Buying Advisor

High-level, ordered phases. Each phase ends in something demonstrable. Detailed
slicing (file paths, agent assignments, step-by-step plans) is produced per
phase by the architect agent — this document deliberately stays above that.

Binding context: `docs/architecture.md`, `docs/backend-stack.md`,
`docs/frontend-stack.md`, `docs/core-requirements.md`.

---

## Agreed product decisions

Recorded from planning discussion (2026-08-26); these govern scope below.

- **Specs are LLM-extracted, admin-verified.** Ingestion always starts with
  Wikipedia as the first source, then web search focused on product sites,
  technical documentation and domain magazines (e.g. ADAC). Extracted specs
  are drafts until an admin approves them.
- **Backlog is a flag/status on the motorbikes table**, not a separate entity.
  Models enter the backlog two ways: an admin adds one manually, or the
  advisor flags a bike a customer mentioned that isn't in the catalogue yet.
- **Admin review happens in the admin UI**: fetched documents, extracted
  specs, and fetched images are reviewed and approved there before a model
  goes live. The CLI only bootstraps the first admin.
- **Product images are fetched during ingestion** (Wikipedia first —
  licence-friendly); the admin can reject/replace them in review.
- **Consultation is a guided interview**: the advisor deliberately interviews
  the customer (experience, use case, budget, physique …), captures
  firmness-tagged preferences, then recommends models. Free-form questions
  are allowed, but the agent steers.
- **Recommendations render as cards in the chat linking to model detail
  pages.** No dedicated comparison screen — comparisons happen
  conversationally via a tool call whose result renders in the chat.
- **Everything is behind login.** Open self-signup; roles `user`/`admin`;
  admin granted via CLI.
- **Four domain tools**: structured catalogue search, spec comparison,
  licence/fit checks (A2 compliance, rider fit), cost estimator.

---

## Phase 0 — Foundations

**Goal: both apps run locally via Docker Compose and talk to each other.**

- **0.1 Backend scaffolding** — FastAPI skeleton, PostgreSQL + pgvector,
   Alembic baseline, Typer CLI entry point, settings via `.env`,
   `/health` + `/ready`, Compose services (`app-web`, `postgres`, `redis`).
- **0.2 Frontend scaffolding** — Vite + React + TypeScript, Material UI theme
   (system/light/dark), React Router shell, TanStack Query, i18n bootstrap,
   OpenAPI type-generation pipeline (`app openapi export` → generated client).

*Done when:* `docker compose up` starts everything; the SPA loads and shows
backend health.

## Phase 1 — Accounts & access

**Goal: a person can register, sign in, and be made an admin.**

Two parallel tracks (backend `1.1 → 1.3 → 1.5`, frontend `1.2 → 1.4 → 1.6`)
with a single sync point: 1.6 needs 1.3. The binding contract for all steps is
`docs/roadmap/phase-1/shared-knowledge.md`; UI specs live in
`docs/roadmap/phase-1/ui-spec.md`.

- **1.1 Auth data model & services** *(backend)* — `users` + `sessions`
   tables, Alembic migration, `UserService`/`SessionService` (Argon2, hashed
   opaque session tokens, constant-time login, session revocation).
- **1.2 Auth screens, UI-only** *(frontend)* — login/registration forms with
   client-side validation against a stubbed `useAuth`; no backend needed.
- **1.3 Auth endpoints, cookies & CSRF** *(backend)* — `/auth/*` endpoints,
   session + CSRF cookies ("remember me"), `current_user`/`current_admin`/
   `csrf_protect` dependencies; freezes the OpenAPI surface.
- **1.4 Route guards & admin shell, UI-only** *(frontend)* —
   `RequireAuth`/`RequireAdmin` with the spinner pattern, empty admin area,
   role-conditional nav and sign-out UI.
- **1.5 CLI user commands** *(backend)* — `app users set-role` /
   `reset-password`; the first-admin bootstrap path.
- **1.6 Frontend auth wiring** *(frontend, sync point)* — regenerate API
   types, CSRF/401 client middleware, replace the stub, end-to-end
   login/register/logout.

*Done when:* register → login → see the (empty) app; CLI promotes the account;
admin section becomes visible only for that account.

## Phase 2 — Catalogue data & ingestion (admin side)

**Goal: an admin can put a motorcycle name into the backlog and end up with an
approved catalogue entry — documents, verified specs, image.**

Two parallel tracks, 21 steps of effort ≤ 4, two cross-track sync points
(S1: 2.15 needs 2.7; S2: 2.20 needs 2.17 + 2.9). The binding contract is
`docs/roadmap/phase-2/shared-knowledge.md`; UI specs live in
`docs/roadmap/phase-2/ui-spec.md`.

Backend track (`backend-dev`):
- **2.1 Catalogue domain models & services** — four tables, one migration,
   transition matrix, approval promotion (draft→verified).
- **2.3 JSON:API layer & `/api/products`** — the internal JSON:API layer +
   the products resource (freezes the S1 OpenAPI surface with 2.6).
- **2.5 Taskiq broker & worker service** · **2.6 Operations model/service/
   NOTIFY/API** · **2.7 SSE endpoint & LISTEN fan-out** *(merging 2.7 = S1)*.
- **2.9 Documents & images endpoints** — read-only provenance + image
   approve/reject.
- **2.10 Fetch & extract core** · **2.11 Wikipedia + web-search adapters** ·
   **2.12 Image pipeline (Pillow variants, `/media`)** ·
   **2.14 Ingestion orchestration job**.
- **2.16 LLM foundation (OpenRouter via LangChain)** ·
   **2.17 Spec extraction** *(merging 2.17 = S2)* ·
   **2.18 Chunks table & chunking** · **2.19 Embeddings & re-embed CLI**.

Frontend track (`frontend-dev`; 2.2/2.4/2.8/2.13 need zero backend code):
- **2.2 Admin UI spec** *(ui-ux-designer — done)* · **2.4 SSE client hook** ·
   **2.8 Backlog screen, UI-only** *(stubbed)* ·
   **2.15 Wire backlog live** *(S1)* ·
   **2.13 Review screen, UI-only** *(stubbed)* ·
   **2.20 Wire review live** *(S2)*.

- **2.21 Phase-2 acceptance run** *(qa)* — the done-criterion, end-to-end.

Commit per finished step; tag at the five milestones pinned in
`shared-knowledge.md` (M1 plumbing & shells → M2 live backlog → M3 real
ingestion → M4 review live & knowledge base → M5 acceptance) — each a point
where both tracks converge into something demoable.

*Done when:* admin types "Suzuki GSR 600", watches ingestion run, reviews and
approves it, and the model exists in the live catalogue with verified specs.

## Phase 2b — Manufacturers table (interlude)

**Goal: manufacturers become a first-class table (name, description, logo —
NULL for now) instead of a free-text column; extraction fills it; an
admin-only read API exposes it.** Admin UI for managing manufacturers is out
of scope. (Owner-requested refactor, 2026-08-27, before Phase 3 starts.)

Backend-only, 4 steps of effort ≤ 4. The binding contract is
`docs/roadmap/phase-2b/shared-knowledge.md`.

- **2b.1 Manufacturers table, migration & derived products attribute** —
   new table + FK, legacy column dropped, products wire shape preserved by
   derivation (zero frontend changes).
- **2b.2 Extraction fills the manufacturer + backfill CLI** — get-or-create
   on ingest; deterministic CLI backfills the 3 existing bikes without
   touching embeddings.
- **2b.3 `/api/manufacturers` read endpoints** — admin-only, read-only.
- **2b.4 Phase-2b acceptance run** *(qa)* — tags `phase-2b-done`.

*Done when:* the three approved bikes point at manufacturers rows, a fresh
ingest assigns its brand automatically, the products API is byte-compatible,
and the Phase-3 prerequisite (approved, embedded models) still holds.

## Phase 3 — Retrieval, the advisor agent & the consultation UI

**Goal: the advisory brain works end-to-end, and a customer can hold the
consultation in the browser.** (Re-sliced 2026-08-27: the consultation UI —
formerly step 4.1 — moved into this phase so each feature is built by
frontend and backend in parallel.)

Two parallel tracks, 17 steps of effort ≤ 4, two cross-track sync points
(S1: 3.6 needs 3.3 + 3.5; S2: 3.15 needs 3.13 + 3.14). The binding contract
is `docs/roadmap/phase-3/shared-knowledge.md`; UI specs live in
`docs/roadmap/phase-3/ui-spec.md`.

Backend track (`backend-dev`):
- **3.1 Chat persistence** — chats/messages/preferences tables (one
   migration), ChatService, firmness supersession.
- **3.3 Chat JSON:API endpoints** — chats + chat-messages resources incl.
   the frozen message-part contract *(with 3.5 = S1)*.
- **3.5 Minimal chat responder job** — plain-LLM replies via Taskiq,
   operation lifecycle, stale-turn healing, apologetic failure path.
- **3.7 Hybrid retrieval** — FTS + pgvector + RRF over the existing indexes,
   provenance-carrying results.
- **3.8 Query translation** · **3.9 RAG pipeline** — conversational language
   → retrieval queries + spec filters → candidate-scoped fused retrieval.
- **3.11 Domain tools I (convention, catalogue search, spec comparison)** ·
   **3.12 Domain tools II (licence/fit check, cost estimator)**.
- **3.13 Advisor agent loop** — guided interview, tool loop with limits,
   persisted tool calls/sources/recommendations *(with 3.14 = S2)*.
- **3.14 Preference capture & unknown-bike flagging**.
- **3.16 Scripted-conversation demo & prompt hardening**.

Frontend track (`frontend-dev`; 3.4/3.10 need zero backend code):
- **3.2 Consultation ui-spec** *(ui-ux-designer — done)* ·
   **3.4 Chat shell, UI-only** *(stubbed)* ·
   **3.6 Wire chat live** *(S1)* ·
   **3.10 Tool renderers, sources & recommendation cards, UI-only** ·
   **3.15 Wire advisor UI live** *(S2)*.

- **3.17 Phase-3 acceptance run** *(qa)* — the done-criterion, end-to-end.

Commit per finished step; tag at the five milestones pinned in
`shared-knowledge.md` (M1 chat plumbing & shells → M2 live chat → M3 the
RAG brain → M4 the advisor → M5 acceptance) — each a feature where both
tracks converge into something demoable.

*Done when:* a scripted conversation over the API yields a plausible
interview, visible tool calls, recommendations grounded in approved models,
and sources attached — and the same interview works in the browser with
seen/typing states, visible tool results, sources, and recommendation cards,
resumable after closing the browser.

## Phase 4 — Customer catalogue

**Goal: the browsable catalogue completing the customer experience.**

**Status: DONE (2026-08-28, tagged `phase-4-done`).** All steps landed and
QA-proven except 4.5, which was dropped/deferred: the pinned row-lock fix is
provably insufficient and any working fix changes a Phase-3 pin — owner
decision pending, see `docs/roadmap/phase-4/open-questions.md` OQ4.

Re-sliced 2026-08-28 into two parallel tracks (backend ∥ frontend, max
effort 4 per step, three milestones) — binding contract:
`docs/roadmap/phase-4/shared-knowledge.md`; UI:
`docs/roadmap/phase-4/ui-spec.md`.

- **4.1** *(superseded — moved into Phase 3; see
    `docs/roadmap/phase-4/step-4.1.md` for the mapping).*
- **4.2** *(split into 4.3–4.11; see `docs/roadmap/phase-4/step-4.2.md`
    for the mapping).*
- **4.3 Catalogue browse & image service reads** (backend) — browse query
    reusing the advisor's filter vocabulary, newest-approved-image read.
- **4.4 `/api/catalogue-models` endpoints** (backend) — customer-facing
    read-only resource (slim filtered/sorted list, self-contained detail);
    `GET /api/manufacturers` relaxed to signed-in users; opens S1.
- **4.5 Concurrent-turn 409 race fix** (backend) — *dropped/deferred: the
    pinned migration-free row lock provably cannot close the race
    (check-then-act spans commits); owner decision pending in
    `docs/roadmap/phase-4/open-questions.md` OQ4.*
- **4.6 Phase-4 UI spec** (design) — done at slicing time (`ui-spec.md`).
- **4.7 Catalogue list page on stubs** (frontend) — card grid,
    URL-persisted filter panel, pagination, nav entry.
- **4.8 Model detail page on stubs** (frontend) — gallery, grouped verified
    specs, article prose, out-of-chat Sources block.
- **4.9 Catalogue wired live + recommendation-card link** (frontend, S1) —
    real hooks, SSE invalidations, the `/catalogue/:motorbikeId` card link
    reserved in Phase 3.
- **4.10 Demo-script catalogue chapter** (docs).
- **4.11 Phase acceptance** (QA) — evidence run; tag `phase-4-done`.

*Done when:* a fresh user filters the catalogue, opens a model detail page
from a recommendation card, and an unapproved model is unreachable by direct
URL.

## Phase 5 — Hardening & submission

**Goal: grading-ready.**

- **5.1 Error handling & validation sweep** — input validation everywhere,
    graceful LLM/ingestion failure states, prompt-injection defences around
    retrieved web content.
- **5.2 Observability & polish** — optional Langfuse wiring, progress
    indicators audit, empty/loading/error states.
- **5.3 Docs & demo readiness** — README, setup instructions, seed/demo data
    (initial model list ingested), mapping of the implementation to the
    grading criteria.

---

## Requirement coverage (grading)

| Requirement | Where it lands |
|---|---|
| LangChain + OpenRouter | Phases 2 (extraction, embeddings) & 3 (agent) |
| Advanced RAG (query translation, structured retrieval, chunking) | Phases 2 & 3 |
| ≥ 3 tool calls | Phase 3 (four tools) |
| React UI: sources, tool results, progress | Phases 2 (admin) & 3 (customer chat; catalogue in 4) |
| Error handling, validation, security | Phases 1, 5 (and throughout) |

Optional-task bonus (≥ 2 medium + 1 hard) covered by design: **hard** — hybrid
search; **medium** — user authentication & personalisation, prompt-injection
protection, logging/monitoring (Langfuse), real-time knowledge-base updates
(admin-triggered ingestion).
