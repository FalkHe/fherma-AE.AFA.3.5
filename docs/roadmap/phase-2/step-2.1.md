---
phase: 2
step: "2.1"
title: Catalogue domain model
summary: SQLAlchemy models + Alembic migration + minimal JSON:API endpoints for motorbikes (with lifecycle status), source documents with provenance, and draft/verified specs and images.
effort: 8
dependencies: ["0.1", "1.1"]
---

# Step 2.1 — Catalogue domain model

**Effort: 8** — several interrelated tables plus a first real JSON:API resource layer, but no external systems or async work involved.

## Architect's outline

- `backend/app/db/models/motorbike.py`: ULID PK, unique slug, manufacturer, model name, year range, `status` enum (`backlog | ingesting | in_review | approved | rejected`), timestamps. Backlog is just `status = backlog` — no separate entity.
- `backend/app/db/models/source_document.py`: FK to motorbike, `source_type` (`wikipedia | product | technical | magazine | upload`), `source_url`, `source_title`, raw content reference, normalized Markdown text, `fetched_at`.
- `backend/app/db/models/motorbike_spec.py`: one row per motorbike per `kind` (`draft | verified`), typed columns for the core spec set Phase-3 tools filter on (engine cc, power kW, torque, wet weight, seat height, A2-eligible flag, price band, category, …) plus a JSONB `extra` for the long tail — typed columns over pure JSONB because structured retrieval and licence checks need SQL-filterable fields.
- `backend/app/db/models/motorbike_image.py`: FK, source URL, licence/attribution text, status (`pending | approved | rejected`), variant file paths.
- Single Alembic migration for all four tables.
- `product_service.py` and `document_service.py`: create-in-backlog, status transitions with legal-transition validation, spec upsert; services own transactions.
- JSON:API endpoints (`products.py`, `documents.py`): list/filter by status, get with includes (specs, documents, images), `POST /api/products` (admin) creates a backlog entry, `PATCH` for spec edits and status. Status transitions via `PATCH` of the `status` attribute with server-side validation — simpler than action endpoints.
- Agent assignment: **backend-dev**.

## Verification

- `alembic upgrade head` succeeds; `POST /api/products` as admin creates a backlog row; `GET /api/products?filter[status]=backlog` returns it; illegal transition (backlog → approved) returns 422.

## Risks / notes

- Lock the core spec column set now (docs-writer records it); Phase-3 tools depend on it and churn here means migrations later.
- Decide `rejected` semantics up front: terminal vs. re-queueable back to backlog (recommended: re-queueable).
