---
phase: 3
step: "3.1"
title: Hybrid retrieval
summary: A RetrievalService combining PostgreSQL full-text search and pgvector cosine similarity over chunks via Reciprocal Rank Fusion, filterable by motorbike and lifecycle status, returning chunks with full provenance.
effort: 8
dependencies: ["2.1", "2.5"]
---

# Step 3.1 — Hybrid retrieval

**Effort: 8** — the RRF SQL, indexes/migration, query-embedding wiring, and a CLI harness are each small but must be tuned and verified together against real ingested data.

## Architect's outline

- Alembic migration: generated `tsvector` column on the chunks table (`to_tsvector('english', text)`) with a GIN index, plus an HNSW (cosine) index on the embedding column.
- `backend/app/services/retrieval_service.py`: `search(query_text, *, motorbike_ids=None, only_approved=True, limit=10)` — embeds the query via the configured OpenRouter embedding model (reusing the Phase-2 `EmbeddingService`), runs one SQL statement with two ranked CTEs (FTS rank, vector distance) fused by RRF (`k=60`), joined to motorbike + source-document metadata.
- Metadata filtering happens inside the SQL (motorbike id list, status = approved, embedding model matches configured model) — never post-filtering in Python.
- Result model `RetrievedChunk`: text, score, and provenance exactly as `docs/architecture.md` defines (`sourceDocumentId`, `sourceUrl`, `sourceTitle`, `headingPath`, `pageNumber`, `sequence`) plus `motorbikeId`.
- Guard: if stored embedding dimensions/model mismatch the configured model, fail with a clear error pointing at the re-embed CLI command.
- Typer command `app retrieval search "smooth beginner-friendly middleweight" [--bike <ulid>]` printing ranked results with scores and provenance.
- Unit tests for RRF fusion ordering and the filter clauses (seeded fixture chunks).
- Agent assignment: **backend-dev** (qa reviews the fusion tests).

## Verification

- `docker compose exec app-web app retrieval search "comfortable touring bike"` returns ranked chunks with source titles/URLs from an approved Phase-2-ingested model; `--bike` restricts results to that model.

## Risks / notes

- RRF weights/`k` and per-leg candidate counts (e.g. top 50 each) need one tuning pass on real data — keep them settings, not literals.
- English-only FTS config is a deliberate simplification; don't add language detection.
