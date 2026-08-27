---
phase: 4
step: "4.2"
title: Catalogue browsing
summary: A read-only customer catalogue — filterable model list with URL-persisted filters, and a model detail page showing verified specs, prose, sources, and images.
effort: 8
dependencies: ["0.2", "1.1", "1.3", "2.1", "2.3", "2.6", "3.11", "3.15"]
---

# Step 4.2 — Catalogue browsing

**Effort: 8** — two read-only pages against mostly existing endpoints with straightforward MUI composition; the only nuance is URL filter state and role-scoped visibility. Also adds the recommendation-card link reserved in Phase 3 (`/catalogue/:productId` — wrap `RecommendationCard` content in a `CardActionArea`, ui-spec §9).

## Architect's outline

- **Backend visibility & filters** (backend-dev, small): ensure `/api/products` serves non-admin users only `approved` models and exposes the filter params the UI needs (manufacturer — since Phase 2b a `manufacturers` table + `motorbikes.manufacturer_id` FK, and an admin-only `GET /api/manufacturers` exists; this step decides the customer-facing filter semantics, id vs slug, and whether to re-expose that endpoint — see `../phase-2b/shared-knowledge.md`; category, price range, engine displacement, seat height, A2-eligible) plus sort (name, price) with page-number pagination; reuse the Phase-3 catalogue-search tool's filter logic via the service layer — no duplication in the route.
- **Catalogue list page** (frontend-dev): `CatalogueListPage.tsx` at `/catalogue` — responsive MUI card grid (image with `srcset`/lazy, name, category, price, 2–3 headline specs), cards linking to detail.
- **URL-persisted filters**: `CatalogueFilters.tsx` mapping every filter and the sort/page to React Router search params (`useSearchParams`) as the single source of truth — no duplicate local state; TanStack Query key derives from the parsed params.
- **Model detail page**: `ModelDetailPage.tsx` at `/catalogue/:productId` (ULID — the href contract reserved in the Phase-3 ui-spec §9) — the target of the Phase-3 recommendation cards; wire the card link here.
- **Detail content**: image gallery from ingest-time variants; verified-specs table grouped by section (engine, dimensions, licence class); prose sections via react-markdown (raw HTML off — this is retrieved web content); "Sources" section listing source-document titles + external URLs, satisfying the grading requirement outside the chat too.
- **States**: loading skeletons, error state, 404 for unknown/unapproved IDs, empty-catalogue and no-filter-match states; "Catalogue" nav entry in the app shell.
- **UX pass** (ui-ux-designer): filter panel on mobile (drawer vs inline), spec-table grouping, card hierarchy.
- **QA** (qa): filter → reload → deep-link a detail URL in a fresh session (redirects through login and back); confirm an unapproved model is unreachable by direct URL.

## Verification

- `curl` as a plain user shows no backlog/in-review models; filter params narrow results; set filters, reload the browser, filters and results unchanged; the URL is shareable.

## Risks / notes

- Filter attributes must match what spec extraction actually verified in Phase 2 — confirm available spec fields before designing the filter panel, or filters will be dead controls.
- Keep list-page payloads slim (sparse attributes or summary serialization); full prose + sources belong to the detail response only.
- Decide ULID-vs-slug URLs once here — recommendation cards, admin links, and this page must agree; ULID is the simpler choice unless slugs already exist.
