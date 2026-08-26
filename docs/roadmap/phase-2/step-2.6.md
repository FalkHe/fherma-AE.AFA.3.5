---
phase: 2
step: "2.6"
title: Admin backlog & review UI
summary: Admin SPA screens to add a model to the backlog, watch ingestion progress live over SSE, review documents/draft specs/image, edit and approve or reject — approval publishes the model.
effort: 16
dependencies: ["1.3", "2.1", "2.2", "2.3", "2.4"]
---

# Step 2.6 — Admin backlog & review UI

**Effort: 16** — three substantial screens (backlog list, live progress, multi-tab review with an editable spec form) plus the approve/reject backend flow.

## Architect's outline

- **Backend additions** (backend-dev): approve = `PATCH /api/products/{id}` status → `approved`, which promotes the (possibly admin-edited) draft spec to `verified` and marks the image approved, in one transaction; reject → back to `backlog` with the draft retained; `PATCH` on draft spec attributes for admin edits; image reject endpoint (replacement upload can be deferred to a follow-up).
- `pages/admin/BacklogPage.tsx`: table of motorbikes filtered by status (URL-persisted filter), "Add model" dialog (name → `POST /api/products`, ingestion auto-starts), per-row status chip and inline progress (operation % + status message) updating live via the step-2.2 SSE hook — a graded "progress indicator for long operations".
- `pages/admin/ModelReviewPage.tsx`: MUI tabs — Documents (title, source URL, type; Markdown via react-markdown + remark-gfm, raw HTML off), Specs (editable draft-spec form — React Hook Form + Zod justified here, the first form that grows past login), Image (variants preview, attribution, reject).
- Approve/Reject action bar with confirmation dialog; on approve, TanStack Query invalidation flips the row to `approved`.
- Failure surface: a failed ingestion operation shows its error message on the backlog row with a "retry ingestion" action (re-enqueue).
- Routes under the existing admin guard; strings through react-i18next; API types refreshed via `app openapi export`.
- Agent assignments: **ui-ux-designer** (one short layout/flow pass first), **frontend-dev** (implementation), **backend-dev** (approve/edit endpoints), **qa** (end-to-end pass).

## Verification (Phase-2 done-criterion)

- Log in as admin → type "Suzuki GSR 600" → watch progress advance live without reloading → open review, see Wikipedia + web documents with URLs, correct a spec value, approve → `GET /api/products?filter[status]=approved` shows the model with `verified` specs matching the edit.

## Risks / notes

- Keep draft-vs-verified editing unambiguous: admins edit the draft; approval promotes it — never let the UI write `verified` rows directly.
- Image replacement-by-upload can silently balloon this step; if so, split it out and ship review with approve/reject only.
- No advanced data-grid framework — plain MUI `Table` is enough for ~150 rows.

## Sequencing note (phase-level)

Steps 2.1 → 2.2 can be built in parallel by two backend sessions; 2.3 → 2.4 → 2.5 are strictly sequential stages of one job; 2.6 can start its UI skeleton (backlog list, add dialog) as soon as 2.1+2.2 exist, before 2.3–2.4 finish.
