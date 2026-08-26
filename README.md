# Motorcycle Buying Advisor

A conversational AI advisor that interviews a customer about their needs and
recommends motorcycle models, grounded in an internal curated database of
verified specifications and retrieved prose about how those bikes are
actually regarded — rather than an LLM's outdated training data or
marketing-biased public sources. This is the AE.AFA.3.5 Turing College
Sprint 3 project: a domain-specialised RAG chatbot built with LangChain,
advanced RAG techniques, tool calling, and a vector database (see `125.md`
for the full brief and `docs/` for design decisions).

**Current status:** Phase 0 (Foundations) is complete — both apps run in
Docker Compose and the frontend renders live backend health. Accounts,
catalogue ingestion, retrieval and the advisor agent are not implemented yet;
see `docs/roadmap.md`.

## Stack

- Backend: Python, FastAPI, Typer, SQLAlchemy 2 (async), Alembic, PostgreSQL
  (pgvector), Redis — see `docs/backend-stack.md`.
- Frontend: TypeScript, React, Vite, Material UI, TanStack Query, React
  Router, react-i18next — see `docs/frontend-stack.md`.
- Architecture and conventions: `docs/architecture.md`.

## Prerequisites

- Docker and Docker Compose v2 (`docker compose`)
- [uv](https://docs.astral.sh/uv/) — for running the backend outside Docker
- Node.js 24 and [pnpm](https://pnpm.io/) 11.17.0 — for running the frontend
  outside Docker (pnpm version is pinned via the `packageManager` field in
  `frontend/package.json`)

Docker Compose (plus `make` for the shortcuts) is the only requirement — the
Makefile routes tests, lint, type checks, and API-client generation through
one-off CLI containers (`app-cli`, `node-cli` in `compose.yaml`), so no host
Python or Node toolchain is needed. uv and pnpm are only for optionally
running the apps or their checks directly on the host.

## First-run setup

1. Copy the environment template and adjust it if needed:

   ```bash
   cp .env.dist .env
   ```

   **This step is manual and must stay manual.** No agent or tooling in this
   repo creates `.env` automatically — `.env.dist` documents every key with a
   comment, and `.env` itself is git-ignored. Right now `.env` only holds
   non-secret local values (`DATABASE_URL`, `REDIS_URL`, `ENVIRONMENT`,
   `LOG_LEVEL`); a later phase adds the OpenRouter API key, which is exactly
   why the "never auto-create `.env`" rule exists from day one.

2. Start the stack:

   ```bash
   make up          # shorthand for: docker compose up -d
   ```

   A root `Makefile` wraps the common workflows — `make help` lists them all
   (`up`, `down`, `build`, `rebuild`, `logs`, `ps`, plus the test/lint
   targets described below).

   The `app-web` container runs `alembic upgrade head` before starting
   Uvicorn, so Postgres must be healthy first — Compose's `depends_on:
   condition: service_healthy` enforces that.

3. Open:
   - Frontend: <http://localhost:5173>
   - Backend API: <http://localhost:8000>
   - Interactive API docs (dev only, `ENVIRONMENT=development`):
     <http://localhost:8000/docs>

4. Check the logs if something doesn't come up:

   ```bash
   docker compose logs -f app-web
   docker compose logs -f frontend
   ```

## Creating the first admin

No HTTP endpoint grants the admin role — registration always creates a plain
user. Register an account through the UI (or `POST /auth/register`), then
promote it from the CLI:

```bash
docker compose exec app-web app users set-role <name> admin
```

Re-running it is a no-op. The reverse (`... set-role <name> user`) revokes
that account's sessions, as does resetting a password:

```bash
docker compose exec app-web app users reset-password <name>
```

The new password is prompted for twice and hidden — never pass it as an
argument.

## Running the backend locally with uv

The backend's own settings (`backend/app/core/config.py`) fall back to a
`.env` at the repo root, so `uv` commands below work whether you run them
from the repo root or from `backend/`.

```bash
cd backend
uv sync                     # install deps + dev group (ruff) into backend/.venv
uv run app version          # Typer entry point, no infrastructure needed
uv run app openapi export   # prints the OpenAPI schema, no infrastructure needed
uv run ruff check .
```

`DATABASE_URL`/`REDIS_URL` in `.env.dist` point at the Compose service names
(`postgres`, `redis`), which only resolve inside the Compose network.
`compose.yaml` does not publish Postgres's or Redis's port to the host, so
running the full API (`uvicorn`, `/ready`, anything touching the database)
outside Docker isn't supported out of the box. For anything that needs the
database, run it inside the container instead:

```bash
docker compose exec app-web app version
docker compose exec app-web alembic current
```

## Running the frontend locally with pnpm

```bash
cd frontend
pnpm install
VITE_API_URL=http://localhost:8000 pnpm dev   # backend must be reachable at this URL
```

Inside Docker Compose, `VITE_API_URL` is set on the `frontend` service in
`compose.yaml` (not in `.env` — it's a fixed dev value, not a secret). Running
`pnpm dev` without it falls back to same-origin requests, which will not
reach the backend on a different port.

Other scripts (see `frontend/package.json`): `pnpm build`, `pnpm typecheck`,
`pnpm lint`, `pnpm preview`. Frontend-specific details live in
`frontend/README.md`.

## Linting and testing

The Makefile runs everything in one-off Docker containers (`app-cli` /
`node-cli`) — no host toolchain needed, and the stack does not have to be up:

```bash
make test           # backend-test + frontend-test
make backend-test   # docker compose run --rm app-cli pytest
make frontend-test  # docker compose run --rm node-cli pnpm test
make lint           # backend-lint + frontend-lint + frontend-typecheck
```

Run `make build` (or `make rebuild`, which also recreates the running stack
and renews the frontend's `node_modules` volume) after dependency changes so
the CLI images stay fresh. `make backend-cli` / `make frontend-cli` open a
bash shell in a throwaway container for ad-hoc commands.

The same checks also run directly on the host, no Docker needed:

Backend (from `backend/`, after `uv sync`):

```bash
uv run pytest                 # test suite (backend/tests/, config in pyproject.toml)
uv run ruff check .           # lint — rules configured in backend/pyproject.toml
uv run ruff format --check .  # formatting check (drop --check to apply)
```

Frontend (from `frontend/`, after `pnpm install`):

```bash
pnpm test       # Vitest, one-shot run (pnpm test:watch for watch mode)
pnpm lint       # ESLint (frontend/eslint.config.js)
pnpm typecheck  # TypeScript type check across all tsconfig projects
```

Both test suites run entirely on the host with no infrastructure: backend
tests stub the database session via FastAPI dependency overrides (never a
real engine — see the `lru_cache`'d async-engine pitfall in
`docs/qa-checklist.md`), and frontend tests run in jsdom against a stubbed
`fetch`, so neither needs Docker Compose, Postgres, or the backend running.
Frontend test setup lives in `frontend/vitest.config.ts` and
`frontend/src/test/`.

## Regenerating the typed API client

The frontend calls the backend through a typed `openapi-fetch` client whose
types are generated from the backend's own OpenAPI schema and committed to
git (`frontend/src/api/schema.d.ts`). Whenever a backend route or schema
changes:

```bash
make generate-api
```

This exports the schema from the running `app-web` container (so the stack
must be up) and feeds it into `openapi-typescript` inside a one-off
`node-cli` container — no host Node needed. (`cd frontend && pnpm
generate:api` still works as a host-side alternative if you have pnpm.)
Commit the regenerated `schema.d.ts`. See `docs/qa-checklist.md` for the
convention that keeps it from drifting.

## Further reading

- `docs/architecture.md` — binding architecture decisions
- `docs/backend-stack.md`, `docs/frontend-stack.md` — stack choices and why
- `docs/roadmap.md` — phased implementation plan
- `docs/core-requirements.md` — grading requirements
- `docs/qa-checklist.md` — QA checklist and known rough edges
- `125.md` — original task brief
