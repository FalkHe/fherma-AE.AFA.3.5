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

- **2.1 Catalogue domain model** — motorbikes with a backlog/lifecycle status
   flag (backlog → ingesting → in review → approved), source documents with
   provenance, draft vs verified specs.
- **2.2 Background job infrastructure** — Taskiq + Redis, operation state in
   PostgreSQL, SSE notification channel (LISTEN/NOTIFY → EventSource),
   progress visible to the frontend.
- **2.3 Ingestion pipeline** — Wikipedia first, then web search over product /
   technical / magazine sources; fetch, main-text extraction, normalized
   Markdown, provenance retained; image fetch + Pillow variants.
- **2.4 Spec extraction** — structured LLM output over the fetched material
   produces draft specs per model.
- **2.5 Chunking & embeddings** — deliberate structural chunking, embeddings
    via OpenRouter (model + dimensions recorded), CLI re-embed command.
- **2.6 Admin backlog & review UI** — add a model to the backlog, watch
    ingestion progress live, review documents + extracted specs + image,
    edit/correct, approve or reject. Approval publishes the model.

*Done when:* admin types "Suzuki GSR 600", watches ingestion run, reviews and
approves it, and the model exists in the live catalogue with verified specs.

## Phase 3 — Retrieval & the advisor agent

**Goal: the advisory brain works end-to-end (testable via API/CLI before the
customer UI exists).**

- **3.1 Hybrid retrieval** — full-text search + pgvector similarity + RRF, with
    metadata filtering; provenance flows through to results.
- **3.2 Advanced RAG** — query translation/rewriting of conversational customer
    language into retrieval queries; structured retrieval combining spec
    filters with prose search.
- **3.3 Domain tools** — structured catalogue search, spec comparison,
    licence/fit checks, cost estimator; each a tool the agent calls, backed
    by verified catalogue data.
- **3.4 Advisor agent** — guided-interview behaviour, firmness-tagged preference
    capture, recommendation generation with cited sources; chat persistence
    and resumability; flags unknown bikes into the backlog.

*Done when:* a scripted conversation over the API yields a plausible
interview, visible tool calls, recommendations grounded in approved models,
and sources attached.

## Phase 4 — Customer frontend

**Goal: the product as a customer experiences it.**

- **4.1 Consultation UI** — consultation list (resume anytime), chat view with
    seen/typing states over SSE, retrieved sources shown, tool-call results
    displayed, recommendation cards linking to model detail pages.
- **4.2 Catalogue browsing** — model list with URL-persisted filters, model
    detail page (verified specs, prose, sources, images).

*Done when:* a fresh user registers, is interviewed, gets recommendation
cards, opens a model detail page, closes the browser, and resumes the
consultation later.

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
| React UI: sources, tool results, progress | Phases 2 (admin) & 4 (customer) |
| Error handling, validation, security | Phases 1, 5 (and throughout) |

Optional-task bonus (≥ 2 medium + 1 hard) covered by design: **hard** — hybrid
search; **medium** — user authentication & personalisation, prompt-injection
protection, logging/monitoring (Langfuse), real-time knowledge-base updates
(admin-triggered ingestion).
