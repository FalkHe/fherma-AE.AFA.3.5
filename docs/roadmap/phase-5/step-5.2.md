---
phase: 5
step: "5.2"
title: Observability & polish
summary: Wire the optional Langfuse callback (config-gated, with its optional Compose stack) and audit every screen for progress indicators, empty, loading, and error states.
effort: 8
dependencies: ["2.2", "2.6", "3.15", "4.2", "5.1"]
---

# Step 5.2 — Observability & polish

**Effort: 8** — Langfuse itself is one callback handler plus Compose profile work, but the full-app UI-state audit across chat, catalogue, admin backlog, and review screens is the bulk of a day. Best done after step 5.1 so the error states being polished are the final ones.

## Architect's outline

- **Langfuse callback factory** (backend-dev): `backend/app/llm/observability.py` returning a Langfuse LangChain callback handler when `LANGFUSE_*` settings are present, else `None`; attached at every chain/agent invocation (advisor agent, spec extraction, query translation, embeddings). No traces/token/cost data in the app database.
- **Langfuse Compose profile** (backend-dev): optional services `langfuse-web`, `langfuse-worker`, `clickhouse`, `valkey`, `minio` behind a Compose profile (`--profile langfuse`), with the `langfuse` database on the existing PostgreSQL.
- **Failure isolation** (backend-dev): a down/misconfigured Langfuse never fails an LLM call (handler errors swallowed/logged); verify with a wrong `LANGFUSE_HOST` — chat still works.
- **Progress-indicator audit** (ui-ux-designer defines, frontend-dev implements): every long operation has a visible indicator driven by `operation.updated` SSE events — ingestion progress per backlog row, "seen/typing…" in chat, re-embed job status; checked screen by screen against `docs/core-requirements.md` §5.
- **Empty states** (frontend-dev): shared `EmptyState` component for: no consultations yet, empty catalogue, no filter matches, empty backlog, model with no images/sources.
- **Loading states** (frontend-dev): MUI Skeletons for catalogue list, model detail, consultation list, chat history load; no layout jumps on resolve.
- **Error/reconnect states** (frontend-dev): TanStack Query error boundaries with a retry action; a subtle "reconnecting…" indicator when the EventSource drops, clearing on reconnect.
- **QA walkthrough** (qa): a state matrix (screen × {loading, empty, error, in-progress}) executed manually — throttled network for loading, fresh account for empty, stopped backend for error, live ingestion for progress.

## Verification

- With Langfuse configured, one consultation shows a full trace (agent steps + tool calls) in the Langfuse UI; with it unset, everything runs identically; `docker compose --profile langfuse up` starts the stack, plain `docker compose up` does not; the state matrix passes.

## Risks / notes

- The self-hosted Langfuse stack is heavy (4 extra services); it's a bonus item — keep it strictly profile-gated and never let submission depend on it running.
- Verify Langfuse/LangChain version compatibility first; the callback-handler API has shifted between major versions.
- Resist redesigning screens during the audit — this step adds states to existing screens only.
