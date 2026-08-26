---
phase: 3
step: "3.4"
title: Advisor agent
summary: A tool-calling LangChain agent (plain tool loop, no LangGraph) that runs the guided interview inside a Taskiq job, captures firmness-tagged preferences, produces recommendations with cited sources, persists everything to PostgreSQL for resumability, and flags unknown bikes into the backlog.
effort: 16
dependencies: ["1.1", "2.2", "3.2", "3.3"]
---

# Step 3.4 — Advisor agent

**Effort: 16** — integrates steps 3.1–3.3 plus new chat/preference persistence, a job-driven agent loop with step limits, structured recommendation output, and end-to-end scripted verification; roughly two solid days.

## Architect's outline

- DB models + migration (`backend/app/db/models/chat.py`): `chats` (owner, title, status), `chat_messages` (role, content, `tool_calls` JSONB with args+results, `sources` JSONB with provenance, `recommendations` JSONB), `chat_preferences` (chat-scoped: attribute, value, `firmness` enum `hard|soft|exploring`, superseded-by for revisions).
- `ChatService`: create chat, append user message, enqueue response job, persist completed assistant message first, then NOTIFY `chat.message.created`; owns transactions.
- JSON:API endpoints (`api/endpoints/chats.py`): `POST/GET /api/chats`, `GET/POST /api/chat-messages` (filtered by chat), session-cookie auth + CSRF, ownership checks, message length/shape validation.
- System prompt `backend/app/llm/prompts/advisor_system.md`: interview stages (experience → licence → use case → budget → physique → preferences), steer-but-allow-free-form behaviour, cite-sources instruction, refuse out-of-domain requests (domain security measure).
- Agent loop in `backend/app/llm/agents/advisor.py`: ChatOpenRouter with the four step-3.3 tools, a `retrieve_bike_knowledge` tool wrapping the step-3.2 pipeline, a `record_preference` tool (structured firmness capture → `chat_preferences`), and a `flag_unknown_bike` tool inserting a backlog-status motorbike via the catalogue service (an explicitly permitted low-risk autonomous write); configurable max tool steps and wall-clock timeout.
- Taskiq task `generate_chat_response`: rebuilds LLM context from persisted history + non-superseded preferences (resumability = persistence; interrupted jobs rerun from the last user message), records operation state for the typing indicator, retries only transient LLM failures.
- Recommendation structured output: final answer includes `recommendations: [{motorbikeId, reasoning, matchedPreferences}]` and per-claim source provenance, both persisted on the assistant message so Phase-4 cards and source panels are pure rendering.
- Failure handling: agent/tool errors produce a persisted apologetic assistant message plus a failed operation — never a silent dead chat.
- Verification script `backend/scripts/demo_conversation.py` (or `app chat simulate`): register/login via HTTP, run a 6–8 turn scripted interview over the real API, assert tool calls occurred, recommendations reference approved models, sources attached, and re-fetching the chat reproduces full history.
- Tests: preference supersession, context rebuild from history, unknown-bike flag creates exactly one backlog entry (idempotent on name).
- Agent assignment: **backend-dev** (qa runs and hardens the scripted-conversation check).

## Verification

- Demo script against `docker compose up` prints the interview, ≥3 distinct tool calls with results, recommendation JSON grounded in approved models with provenance; mentioning an uncatalogued bike leaves a new backlog row; killing the worker mid-response and re-sending the message still completes.

## Risks / notes

- Interview quality is prompt work with a long tail — timebox iteration; "plausible interview" (the phase's done-criterion) is the bar, not perfection.
- Context growth over long chats: start with full history replay (simplest); add a rolling summary only if token limits actually bite.
- `flag_unknown_bike` needs dedup against existing catalogue/backlog names or repeated mentions spam the backlog.
