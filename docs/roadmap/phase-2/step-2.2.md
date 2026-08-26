---
phase: 2
step: "2.2"
title: Background job infrastructure
summary: Taskiq + Redis broker with operation state in PostgreSQL, LISTEN/NOTIFY fan-out to an SSE endpoint, and a frontend EventSource hook that invalidates TanStack Query caches.
effort: 8
dependencies: ["0.1", "0.2", "1.1"]
---

# Step 2.2 — Background job infrastructure

**Effort: 8** — a well-trodden pattern with clear docs in `docs/architecture.md`, but it spans worker container, DB, SSE, and frontend glue.

## Architect's outline

- `backend/app/jobs/broker.py`: Taskiq Redis broker setup + a trivial `ping` demo task; `app-worker` Compose service (same image, worker entrypoint, never runs migrations).
- `backend/app/db/models/operation.py` + migration: ULID PK, `type`, `status` (`queued | running | succeeded | failed`), progress percent, status message, optional entity ref (e.g. motorbike id), timestamps; exposed read-only at `/api/operations`.
- `operation_service.py`: create/advance/complete/fail an operation; every state change commits then emits `pg_notify` on a single app channel with a small JSON payload (`operation.updated`, ids only).
- `notification_service.py`: a per-process psycopg 3 LISTEN loop fanning payloads to connected SSE clients.
- `api/endpoints/events.py`: `GET /api/events` via sse-starlette, session-cookie-authenticated, one connection per SPA, small notification events only.
- `frontend/src/hooks/useServerEvents.ts`: native `EventSource`, maps event types (`operation.updated`, `product.updated`, `document.updated`) to TanStack Query invalidations; mounted once in the authenticated app shell.
- Retry policy per architecture: exponential backoff for transient failures only; no scheduler, no cancellation.
- Agent assignments: **backend-dev** (broker/operations/SSE), **frontend-dev** (hook).

## Verification

- Enqueue the demo task via a dev CLI command; `curl -N /api/events` (with session cookie) shows `operation.updated` events as the operation moves queued → running → succeeded; DevTools shows a query invalidation firing.

## Risks / notes

- LISTEN/NOTIFY payload limit (~8 KB) — keep payloads to ids/types only; clients refetch through the API (enforce in review).
- The listener needs a dedicated long-lived connection with reconnect logic, separate from the pooled sessions.
