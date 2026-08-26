---
phase: 2
step: "2.4"
title: Spec extraction
summary: A LangChain + OpenRouter structured-output call over the fetched Markdown produces one draft spec row per motorbike, run as the final stage of the ingestion job.
effort: 8
dependencies: ["2.1", "2.3"]
---

# Step 2.4 — Spec extraction

**Effort: 8** — one prompt, one Pydantic schema, one chain, but prompt iteration and token-budget handling take real time. This is the project's first LLM call.

## Architect's outline

- OpenRouter chat model factory in `backend/app/llm/` (langchain-openrouter, model via `.env`) — the project's canonical LLM client used by everything later; never the OpenAI API directly.
- Pydantic extraction schema mirroring the step-2.1 core spec columns exactly (numbers with units normalized: kW, kg, mm, cc), each field optional with an optional per-field source hint; LangChain `with_structured_output`.
- Prompt at `backend/app/llm/prompts/spec_extraction.md` (Jinja placeholders, versioned in git): extraction only from provided text, "leave unknown fields null", document content treated as untrusted data (baseline prompt-injection hygiene now; full sweep in step 5.1).
- Input assembly: concatenate normalized Markdown ordered Wikipedia-first, truncated to a configurable token budget (simple head-truncation per document — sufficient for ~5 articles, simpler than map-reduce).
- `spec_extraction_service.py`: runs the chain, validates/converts units, upserts the `draft` spec row; idempotent re-run replaces the draft, never touches `verified`.
- Hooked into `jobs/ingestion.py` as the last stage with its own operation progress message; optional Langfuse callback slot left pluggable.
- Dev CLI `app extract-specs <slug>` to re-run extraction standalone during prompt tuning.
- Agent assignment: **backend-dev**.

## Verification

- After `app ingest "Suzuki GSR 600"`, `GET /api/products/<id>?include=specs` shows a `draft` spec with plausible engine cc / power / weight / seat height; re-running `app extract-specs` overwrites the draft only.

## Risks / notes

- Structured-output support varies by OpenRouter model — pick a default model known to handle tool/JSON mode and pin it in `.env.example`.
- Unit chaos in sources (hp vs kW, dry vs wet weight) — normalize in the schema/prompt now, or the Phase-3 comparison tool inherits garbage.
