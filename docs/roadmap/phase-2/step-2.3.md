---
phase: 2
step: "2.3"
title: Ingestion pipeline
summary: A Taskiq job that, given a backlog motorbike, fetches Wikipedia then web-search results, extracts main text to normalized Markdown with provenance, fetches an image with Pillow variants, and moves the model to in_review.
effort: 16
dependencies: ["2.1", "2.2"]
---

# Step 2.3 — Ingestion pipeline

**Effort: 16** — multiple external integrations (Wikipedia, search provider, HTTPX fetching, trafilatura, Pillow) with real-world messiness, orchestrated inside the job/operation machinery.

## Architect's outline

- `ingestion_service.py` orchestration — status backlog → ingesting; fixed source order: (1) Wikipedia REST API lookup by model name, (2) web search API (provider abstraction, key/provider via `.env`) with query templates biased to product/technical/magazine sources; fetch top ~5 results, optionally follow 1–3 in-page links; no crawling.
- Fetch layer using HTTPX: timeouts, size caps, content-type checks, per-domain politeness delay; trafilatura for HTML main-text extraction; Docling only if a result is a PDF.
- Markdown normalization producing the step-2.1 `source_document` rows with full provenance (`sourceUrl`, `sourceTitle`, `sourceType`, `fetchedAt`); original fetched payload retained permanently on disk (configurable data dir, e.g. `backend/var/data/sources/`).
- Image acquisition: Wikipedia page image first (licence-friendly, attribution captured); Pillow generates the fixed variant set (thumb/card/detail) into a static media dir served by FastAPI static files; `motorbike_image` row in `pending` status.
- `backend/app/jobs/ingestion.py`: Taskiq task per motorbike, updating the step-2.2 operation (progress per source: searching / fetching n of m / extracting / images) for live frontend progress; end state `in_review`, failure returns the motorbike to `backlog` with the operation marked failed.
- Trigger: ingestion enqueued automatically on `POST /api/products` backlog creation (simpler than a separate trigger endpoint); also a dev CLI `app ingest <name>` for testing without the UI.
- Config keys documented in `.env.example`: search provider, API key, fetch limits, media dir. *(docs-writer, small addendum)*
- Agent assignment: **backend-dev**.

## Verification

- `app ingest "Suzuki GSR 600"` (worker running) produces ≥3 `source_document` rows with URLs/titles, a Wikipedia doc first, image variants on disk, motorbike status `in_review`; `GET /api/operations/<id>` shows `succeeded` with progress history messages.

## Risks / notes

- Web search provider choice is open — pick one concrete default (e.g. Tavily or Brave) in this step and hide it behind the abstraction; don't build multi-provider support.
- Bot-blocking or JS-heavy sites yield empty extractions — tolerate partial results (some sources failing is a warning, not a job failure).
- Wikipedia disambiguation ("GSR 600" vs "GSR600") — use a search-endpoint lookup rather than exact title match, and record what was matched for the admin to see.
