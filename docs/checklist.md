# Requirements checklist

How this project satisfies each core requirement of the task brief
(`125.md`, condensed in `docs/core-requirements.md`), and which optional
tasks are already implemented.

Verified against `HEAD 2168707` on 2026-08-30: `make backend-test` (1259
passed) and `make frontend-test` (175 passed, 31 files) both green.
`docs/grading-map.md` maps the same items to file paths in table form; this
document explains *how* each one is implemented. `docs/demo-walkthrough.md`
replays them against a running stack.

**Summary**

| # | Core requirement | Status |
|---|---|---|
| 1 | RAG implementation | Met — hybrid (BM25-style FTS + pgvector) retrieval with RRF |
| 2 | Tool calling (≥3) | Met — 8 domain tools registered |
| 3 | Domain specialisation | Met — motorcycle buying advice, curated KB, fenced prompts |
| 4 | LangChain + OpenRouter, errors, validation | Met |
| 5 | React UI with sources, tool results, progress | Met |

---

## 1. RAG implementation

**Knowledge base.** The corpus is built, not downloaded: an admin adds a
model name, and an ingestion pipeline (`backend/app/services/ingestion/`,
driven by Taskiq jobs in `backend/app/jobs/ingestion.py`) resolves sources
from Wikipedia and a Tavily web search, fetches them over HTTPX, and
normalises each page to Markdown with trafilatura/Docling. The Markdown is
stored permanently as a `source_documents` row plus the raw file under
`backend/var/data/sources/`, so every later claim can be traced back to the
page it came from. `docs/ingestion.md` documents the flow end to end.

**Chunking, embeddings, similarity search.** `backend/app/services/chunking.py`
splits each document structurally (heading-aware, then recursive) at
`CHUNK_SIZE_CHARS` with `CHUNK_OVERLAP_CHARS`, and carries provenance on
every chunk — source document id, URL, title, heading path and sequence —
because a chunk that cannot say where it came from cannot be cited.
Embeddings are produced through LangChain's `OpenAIEmbeddings` pointed at
OpenRouter (`backend/app/llm/embeddings.py`) and stored in a pgvector column
with an HNSW index; `app embeddings rebuild` / `app chunks rebuild` re-run
either stage on demand. Retrieval itself
(`backend/app/services/retrieval_service.py::search`) is deliberately more
than similarity search: a single SQL statement runs a PostgreSQL full-text
leg (`chunks.text_tsv`, GIN) and a pgvector cosine-distance leg over the same
snapshot and fuses them by Reciprocal Rank Fusion. Status, embedding-model
and candidate filters sit inside *both* legs as `WHERE` clauses, never as a
Python post-filter that would silently shrink a page of results. Above that,
`backend/app/services/rag_pipeline_service.py` adds the advanced half — see
"query translation" under requirement 3 — and fuses the per-query rankings
with a second RRF pass.

## 2. Tool calling

Eight tools are registered (`backend/app/llm/agents/tools/`, listed in
`tool_specs()`), well past the required three, and each maps to something a
salesperson actually does: `catalogue_search` (structured filter query over
approved models), `spec_comparison` (side-by-side verified specs),
`licence_fit_check` (A2 / full-licence power-limit compliance),
`cost_estimator` (running-cost estimate from stored specs),
`retrieve_bike_knowledge` (the RAG lookup of requirement 1),
`record_preference` (persists what the customer just revealed),
`flag_unknown_bike` (backlog row when a customer names an uncatalogued
model), and `present_recommendations` (emits the recommendation cards the UI
renders). They cover the brief's three example categories — calculation
(`cost_estimator`, `licence_fit_check`), data analysis
(`spec_comparison`, `catalogue_search`) and retrieval/integration
(`retrieve_bike_knowledge`).

The agent loop is a hand-rolled loop over LangChain's `bind_tools`
(`backend/app/llm/agents/advisor.py`) rather than a prebuilt executor,
because resumability here is persistence: every turn rebuilds its context
from the stored timeline, so a killed worker or a page reload mid-answer
sees the same conversation. Two budgets are enforced in that loop —
`AGENT_MAX_TOOL_STEPS` rounds of tool calls followed by one final invoke
with the tools unbound, and `AGENT_TIMEOUT_SECONDS` around the whole turn —
so a model that keeps reaching for tools still has to produce an answer and
a consultation can never hang in the typing state. Every executed call,
success or failure, is recorded and persisted on the assistant message; a
failed or invented tool call becomes an error `ToolMessage` the model can
recover from, not a dead turn. A live consultation in the step 5.18 replay
used five different tools in a single turn.

## 3. Domain specialisation

**Domain and knowledge base.** The domain is motorcycle buying advice
(`docs/project-vision.md`): the advisor interviews a customer about height,
licence class, budget and use case, then recommends models grounded in
verified specifications plus retrieved prose about how those bikes are
regarded. Only motorcycle product, spec and review documents are ingested,
and `motorbikes.status` gates visibility — the advisor and the customer
catalogue can only ever see `approved` models, so a half-ingested draft
cannot be recommended.

**Domain-specific prompts.** Prompts are versioned Markdown files with Jinja
placeholders under `backend/app/llm/prompts/`: `advisor_system.md` (persona,
interview rules, refusal rules, the rendered active-preference block),
`query_translation.md` and `spec_extraction.md`. Query translation is the
domain-specific advanced-RAG step: "I'm 1.65 m, just got my A2, mostly city
commuting" is split by an LLM pass into 1–3 search queries, hard
`SpecFilters` bounds mapped onto the frozen spec columns, and any bike names
mentioned — so the seat-height bound is answered by SQL rather than by hoping
the vector space understood "1.65 m". Filters that the model cannot support
stay `null`, because an invented filter is a fabricated claim about the
customer.

**Domain security.** The chief domain threat is indirect prompt injection
through ingested third-party pages. `backend/app/llm/fencing.py` is the
single definition site for sentinel fence markers plus a lookalike-stripper,
applied at exactly three surfaces: each retrieved chunk's text in the tool
payload the *model* sees, preference values interpolated into the system
prompt, and context blocks in the translation prompt. The persisted tool
result and `sources[]` stay byte-identical and unfenced, so the UI shows the
real text. This was live-verified against a planted "ignore previous
instructions / you are now DAN" chunk: it was retrieved and cited, and the
advisor reported only the neutral facts and continued the interview. Beyond
that: session-cookie auth with Argon2 password hashing and CSRF tokens
(`backend/app/api/endpoints/auth.py`, `session_service`), role-scoped reads
(customer vs. admin), and a frontend markdown renderer with raw HTML off by
construction and no plugin escape hatch
(`frontend/src/components/UntrustedMarkdown.tsx`). The residual injection
risk is stated honestly in the README's "Known limitations".

## 4. Technical implementation

**LangChain over OpenRouter.** `backend/app/llm/models.py::get_chat_model` is
the single factory for a chat model — `ChatOpenRouter` from
`langchain_openrouter`, the OpenAI-compatible SDK shape, never
`api.openai.com` — and `backend/app/llm/embeddings.py` points LangChain's
`OpenAIEmbeddings` at the same gateway. A caller chooses only *which* model;
the API key, app attribution headers, a 60-second client timeout and two SDK
retries are set centrally, as is the optional Langfuse callback.

**Error handling.** Every API error leaves as a JSON:API error envelope
(`backend/app/api/jsonapi.py::error_document`) with a stable domain code
(`duplicate-model`, `invalid-transition`, `invalid-filter`, …), and a single
catch-all handler in `backend/app/main.py` turns anything unexpected into a
generic 500 `internal-error` — the traceback goes to `logger.exception`, never
to the client. Transient LLM and gateway failures retry through Taskiq's
`SmartRetryMiddleware`; a turn that still fails resolves to an apologetic
assistant message rather than a stuck UI. The RAG pipeline degrades instead
of raising: a failed query translation falls back to plain hybrid search on
the raw utterance, while genuine configuration errors (missing API key,
stale embedding dimensions) propagate as typed exceptions so they get fixed
rather than hidden.

**Input validation.** Validation is schema-level, not scattered through
endpoint bodies: Pydantic field constraints cover the API surface (ULID
patterns on chat ids, `ge`/`le` bounds on catalogue numeric filters, caps on
JSON:API filter members and page numbers, size caps on draft-spec payloads,
username/password rules in `backend/app/api/schemas/auth.py` that
deliberately apply to registration only, since a malformed login is a wrong
credential and must be a 401, not a 422). Crucially, the *LLM* is validated
too: every tool has a Pydantic `Args` schema that bounds what a tool call may
pass, and the query translator's output schema bounds query count, query
length and name length.

## 5. User interface

The UI is React (the brief's Next.js slot) — React 19 + Vite + Material UI +
TanStack Query + React Router, with every string routed through react-i18next
(`docs/frontend-stack.md`). Customers register/log in, run consultations at
`/consultations` (chat), and browse the catalogue with filters and a model
detail page carrying specs, article prose, images and a permanent sources
panel; admins get a backlog and model-review area under `/admin`.

**Sources.** `MessageSources.tsx` renders the receipts under each assistant
message — deduplicated by URL plus heading path, collapsed by default but
always showing the count, every entry an external link that can never
navigate the SPA. The catalogue detail page has the equivalent permanent
panel (`ModelSources.tsx`).

**Tool call results.** `ToolResultBlock.tsx` renders every executed tool
call, always expanded — what the advisor did is part of the answer, not a
debug detail. Four tools have styled renderers (`ToolResultCatalogueSearch`,
`ToolResultSpecComparison`, `ToolResultLicenceFitCheck`,
`ToolResultCostEstimator`), `present_recommendations` renders as
`RecommendationCard`s, and dispatch is a shape check with a generic
key/value fallback, so a failed call or a tool this frontend predates still
shows up rather than silently disappearing.

**Progress indicators.** A chat turn runs as a background job, so
`TypingIndicator.tsx` covers the wait; ingestion and the admin review screens
show live per-step progress via `OperationProgress.tsx`, fed by a plain SSE
stream (`GET /api/events`) that pushes `operation.updated`,
`product.updated` and `document.updated` notifications, and
`LiveConnectionAlert.tsx` surfaces a lost connection instead of silently
freezing.

---

## Optional tasks

Bonus points ask for at least 2 medium and 1 hard task. Implemented below:
**3 medium and 1 hard fully**, plus partials.

### Implemented

| Task | Difficulty | How |
|---|---|---|
| Include source citations in responses | Easy | Every retrieved chunk's provenance is persisted as `sources[]` on the assistant message and rendered by `MessageSources.tsx`; the catalogue detail page has a permanent sources panel. |
| Visualisation of RAG process | Easy | The `retrieve_bike_knowledge` tool result is shown in the transcript with the actual rewritten `queries`, the `appliedFilters` derived by query translation and the `candidateMotorbikeIds` the search was scoped to — the retrieval plan is visible per turn, not just its output. |
| Protect your app against prompt injection | Medium | Sentinel fencing + lookalike-stripping at three surfaces (`backend/app/llm/fencing.py`), prompt rules treating fenced content as data, raw-HTML-off markdown rendering. Live-verified against a planted injection payload. See requirement 3. |
| Add user authentication and personalisation | Medium | Local username/password auth with Argon2, server-side sessions, CSRF tokens and customer/admin roles; personalisation via `record_preference`, which stores captured preferences in `chat_preferences` and feeds them back into the system prompt and retrieval to bias later turns. |
| Visualisation of tool call results | Medium | Per-tool styled renderers plus recommendation cards, described under requirement 5. |
| Real-time data updates to knowledge base | Medium | An admin adds a model while the app runs; ingestion executes as a background job, streams live progress over SSE, and approving the reviewed draft republishes it to the customer catalogue with no deploy or restart. |
| Hybrid search | **Hard** | Full-text (GIN `tsvector`) and vector (HNSW pgvector) legs in one SQL statement, fused by Reciprocal Rank Fusion rather than a weighted score sum, because `ts_rank` and cosine distance are not comparable quantities but their ranks are. A second RRF pass fuses across the translated sub-queries. |

### Partially implemented

- **Conversation history and export** (Easy 1) — history is fully there:
  consultations persist as `chats`/`chat_messages` and are listed and
  resumable at `/consultations`. There is **no export** function.
- **Logging and monitoring** (Medium 10) — structured stdout logging at a
  configurable level throughout, plus optional self-hosted Langfuse tracing
  (`make langfuse-up`) that attaches a callback handler when all three
  `LANGFUSE_*` keys are set. Honest scope: each LLM call lands as its own
  root trace, there is no per-turn grouping, tool calls do not appear at all
  (they run outside any LangChain Runnable), and embeddings calls are never
  traced. No metrics or alerting.
- **Multi-model support** (Medium 1) — `CHAT_MODEL`, `ADVISOR_MODEL` and
  `EMBEDDING_MODEL` are independent settings and OpenRouter fronts every
  vendor, so switching to an Anthropic or Google model is a config change
  (embedding-model changes require a re-embed, which is guarded). There is no
  in-UI model picker or per-request routing.
- **Automated knowledge base updates** (Hard 3) — ingestion is fully
  automated once triggered, but the trigger is an admin action; there is no
  scheduled or event-driven refresh of existing documents.

### Not implemented

Easy: interactive help feature / chatbot guide. Medium: token usage and cost
display; conversation export to PDF/CSV/JSON; remote MCP server tools; rate
limiting and API-key management. Hard: A/B testing of RAG strategies;
multi-language support (the UI chrome is i18n-ready via react-i18next, but
prompts and model output are English-only); advanced analytics dashboard;
tools exposed as MCP servers; RAGAs-style automated RAG evaluation.

Known rough edges are listed under "Known limitations & future work" in the
README — chiefly no token streaming, no rate limiting, English-only model
output, and a known concurrent-turn race that can surface as a 409.
