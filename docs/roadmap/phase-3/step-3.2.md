---
phase: 3
step: "3.2"
title: Advanced RAG — query translation + structured retrieval
summary: An LLM-backed pipeline that rewrites conversational customer language (plus known preferences) into retrieval queries and structured spec filters, narrows candidate bikes via SQL on verified specs, then runs hybrid retrieval scoped to those candidates with cross-query RRF fusion.
effort: 8
dependencies: ["2.4", "3.1"]
---

# Step 3.2 — Advanced RAG

**Effort: 8** — one prompt, one structured-output schema, one pipeline service, and a CLI harness; the work is mostly prompt/schema iteration, not plumbing.

## Architect's outline

- Prompt `backend/app/llm/prompts/query_translation.md` (Jinja placeholders for the customer utterance, conversation summary, and captured preferences; missing variables fail explicitly).
- Pydantic structured-output schema `TranslatedQuery`: `search_queries: list[str]` (1–3 rewrites), `spec_filters` (typed optional fields mirroring verified spec columns: category, max seat height, power range, A2-eligible, price band…), `target_motorbike_names: list[str]` for explicitly named bikes.
- `backend/app/services/rag_pipeline_service.py`: `retrieve(utterance, preferences, chat_context) -> RagResult` — calls the translation LLM (ChatOpenRouter via LangChain, low temperature), resolves `spec_filters` to candidate motorbike IDs via a spec-filter query on verified specs only, then fans the search queries through `RetrievalService` and fuses the per-query rankings with a second RRF pass, deduplicating chunks.
- Fallback path: if translation fails or returns nothing usable, retrieve with the raw utterance and no filters — the pipeline must degrade, never 500.
- `RagResult` carries the translated queries and applied filters alongside the chunks, so the UI (Phase 4) and Langfuse can show *why* these sources were retrieved.
- Typer command `app rag ask "I'm 1.65m, just got my A2, mostly city commuting"` printing translated queries, applied spec filters, matched candidate bikes, and fused chunks.
- Tests: schema round-trip, filter-to-SQL mapping, fallback on malformed LLM output (mocked LLM).
- Agent assignment: **backend-dev**.

## Verification

- `app rag ask` on the example utterance shows an A2/seat-height filter being derived, a candidate-bike shortlist, and prose chunks only from those bikes, each with provenance.

## Risks / notes

- Spec-filter schema must match the *verified* spec columns from step 2.4 exactly — drift here silently empties retrieval; add a test asserting the mapping covers every filterable column.
- Decide unit conventions once (mm, kW, kg, EUR) in the schema and prompt; the licence/fit tool in step 3.3 reuses them.
