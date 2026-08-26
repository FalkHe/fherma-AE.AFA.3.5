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

Docker Compose is the only requirement for just running the stack; uv and
pnpm are only needed for local (non-container) backend/frontend development.

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
   docker compose up -d
   ```

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

Backend (from `backend/`, after `uv sync`):

```bash
uv run ruff check .           # lint — rules configured in backend/pyproject.toml
uv run ruff format --check .  # formatting check (drop --check to apply)
```

Frontend (from `frontend/`, after `pnpm install`):

```bash
pnpm lint       # ESLint (frontend/eslint.config.js)
pnpm typecheck  # TypeScript type check across all tsconfig projects
```

There are **no automated test suites yet** — the backend has no pytest
dependency and the frontend has no test runner. Lint and typecheck are the
current CI-equivalent gates. When backend tests are added, note the
`lru_cache`'d async-engine pitfall documented in `docs/qa-checklist.md`.

## Regenerating the typed API client

The frontend calls the backend through a typed `openapi-fetch` client whose
types are generated from the backend's own OpenAPI schema and committed to
git (`frontend/src/api/schema.d.ts`). Whenever a backend route or schema
changes:

```bash
cd frontend
pnpm generate:api
```

This runs `docker compose exec -T app-web app openapi export > openapi.json`
(so the stack must be up) and feeds that into `openapi-typescript`. Commit
the regenerated `schema.d.ts`. See `docs/qa-checklist.md` for the convention
that keeps it from drifting.

## Further reading

- `docs/architecture.md` — binding architecture decisions
- `docs/backend-stack.md`, `docs/frontend-stack.md` — stack choices and why
- `docs/roadmap.md` — phased implementation plan
- `docs/core-requirements.md` — grading requirements
- `docs/qa-checklist.md` — QA checklist and known rough edges
- `125.md` — original task brief
