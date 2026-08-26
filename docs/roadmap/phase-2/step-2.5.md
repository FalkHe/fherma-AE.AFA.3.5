---
phase: 2
step: "2.5"
title: Chunking & embeddings
summary: Heading-aware structural chunking of normalized Markdown into a pgvector-backed chunks table with full provenance and recorded embedding model/dimensions, plus a CLI re-embed command running as a background job.
effort: 8
dependencies: ["2.1", "2.2", "2.3"]
---

# Step 2.5 — Chunking & embeddings

**Effort: 8** — chunking and pgvector wiring are mechanical; the re-embed job and model-change handling add the day's second half.

## Architect's outline

- `backend/app/db/models/chunk.py` + migration: FK to source document, text, provenance (`sourceDocumentId`, `sourceUrl`, `sourceTitle`, `headingPath`, `pageNumber`, `sequence`), denormalized motorbike id for filtering, `embedding vector`, `embedding_model`, `embedding_dimensions`, plus a generated tsvector column (full-text data lands now; retrieval logic is step 3.1).
- Chunking in `embedding_service.py` (or a small `chunking.py` it owns): split Markdown by heading structure, then recursive character split for oversized sections (target ~800 tokens, ~100 overlap, sizes in config) — deliberately structural, no semantic/LLM chunking.
- Embeddings via OpenRouter's embeddings endpoint using the `.env`-configured model; batch requests; model name + dimensions stored on every chunk row.
- pgvector index decision: with ≤150 models, pick HNSW once and note it in the migration — simpler than tuning IVFFlat lists.
- Chunk+embed hooked as an ingestion stage after spec extraction (documents embedded before review; re-run on demand).
- `backend/app/cli/embeddings.py`: `app embeddings rebuild` — enqueues a Taskiq job that re-chunks/re-embeds everything with the currently configured model, tracked as an operation; handles dimension changes by rewriting rows.
- Agent assignment: **backend-dev**.

## Verification

- After ingestion, `psql` shows chunk rows with non-null vectors, correct `embedding_model`, and `headingPath` values.
- Change the embedding model in `.env`, run `app embeddings rebuild`, and the operation succeeds with all chunks updated to the new model string.

## Risks / notes

- Column dimension is fixed in DDL — if the `.env` model's dimensions differ from the column, fail loudly at startup/rebuild rather than storing truncated vectors; the rebuild path may need an `ALTER COLUMN` strategy (document it).
- OpenRouter embedding endpoint coverage is narrower than chat — confirm the chosen embedding model actually works through OpenRouter early in this step, not in Phase 3.
