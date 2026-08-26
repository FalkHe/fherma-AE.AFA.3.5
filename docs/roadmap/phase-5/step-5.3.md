---
phase: 5
step: "5.3"
title: Docs & demo readiness
summary: Produce the README and setup docs, a seed command that ingests an initial curated model list through the real pipeline, a demo script, and an explicit mapping of the implementation to the grading criteria.
effort: 8
dependencies: ["5.1", "5.2"]
---

# Step 5.3 — Docs & demo readiness

**Effort: 8** — the writing is mechanical, but building/running the seed ingestion for a curated model list end-to-end (with real web fetches and LLM extraction) plus a fresh-clone verification consumes a full session. Depends on 0.1–4.2 for content; 5.1–5.2 should land first so documented behaviour and screenshots reflect final states.

## Architect's outline

- **Seed model list** (backend-dev): curated list of ~10–15 demo motorcycles (spanning A2 beginner bikes, tourers, nakeds — enough for a convincing interview demo) as `backend/app/cli/data/seed_models.json`.
- **Seed CLI command** (backend-dev): `app seed demo` enqueues the standard ingestion job per model — same pipeline, no bypass — with an `--auto-approve` flag publishing models after extraction so graders don't hand-approve fifteen bikes; the admin-review flow is still demoed live with one extra model.
- **README** (docs-writer): what the product is, architecture overview (link to `docs/architecture.md`), prerequisites (Docker, OpenRouter key, web-search key), quickstart (`cp .env.example .env` → `docker compose up` → CLI admin bootstrap → seed → open SPA), CLI reference, optional Langfuse profile.
- **`.env.example`** (backend-dev): every setting with a comment — OpenRouter key + chat/embedding model IDs, web-search provider, session secret, optional `LANGFUSE_*` — in lockstep with the pydantic-settings fields.
- **Demo script** (docs-writer): `docs/demo-script.md` — ordered walkthrough (register → promote admin → add "Suzuki GSR 600" to backlog → watch ingestion → approve → start consultation → interview → recommendation cards with sources and tool results → resume after logout) touching every grading criterion at least once.
- **Grading-criteria map** (docs-writer): `docs/grading-map.md` — a table mapping each item in `docs/core-requirements.md` and each claimed bonus (hybrid search; auth/personalisation; prompt-injection protection; Langfuse; real-time KB updates) to concrete files, endpoints, and screens.
- **Limitations & improvements section** (docs-writer): honest known-limitations/future-work list in the README (residual injection risk, no token streaming, English-only, no rate limiting) — serves the "Reflection and Improvement" evaluation criterion.
- **Fresh-clone verification** (qa): on a clean checkout with only `.env` filled in, follow the README verbatim: compose up, bootstrap admin, seed, run the full demo script; every deviation is a doc bug to fix before submission.

## Verification

- On a fresh database, `docker compose exec app-web app seed demo --auto-approve` ends with all models `approved` and visible at `GET /api/products`; the fresh-clone walkthrough completes without deviation.

## Risks / notes

- Seed ingestion hits live web search + OpenRouter — slow, costs money, can flake per model; the seed command must tolerate individual model failures (report and continue), not abort the whole seed.
- Keep the seed list small enough to ingest in one sitting; 150 models is a production goal, not a demo requirement.
- Auto-approve weakens the "admin-verified" story if overused — the demo script must still show one live admin review to earn that claim.
