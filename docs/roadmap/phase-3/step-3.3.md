---
phase: 3
step: "3.3"
title: Domain tools
summary: Four LangChain tools — structured catalogue search, spec comparison, licence/fit checks, cost estimator — each a thin Pydantic-typed wrapper over a service that reads only verified specs of approved models.
effort: 8
dependencies: ["2.1", "2.4", "2.6", "3.2"]
---

# Step 3.3 — Domain tools

**Effort: 8** — four tools but shallow ones: the pattern (schema → service → serializable result) is built once and repeated; only the fit rules and cost heuristics carry real logic.

## Architect's outline

- Shared convention in `backend/app/llm/agents/tools/__init__.py`: every tool has a Pydantic args schema, returns a JSON-serializable Pydantic result (for persistence and UI rendering), and calls a service — no SQL in tools.
- `tools/catalogue_search.py` + `CatalogueSearchService`: structured filters (category, power, weight, seat height, price band, A2 eligibility) over verified specs, approved models only; reuses the step-3.2 spec-filter schema.
- `tools/spec_comparison.py` + service method: takes 2–4 motorbike IDs/names, returns an aligned spec table (attribute → per-bike values, nulls explicit) — this result renders as the in-chat comparison per the product decision.
- `tools/licence_fit_check.py` + `FitCheckService`: A2 compliance (≤ 35 kW, power/weight ≤ 0.2 kW/kg, restricted-version note where derived data exists) and rider fit (seat height vs. rider inseam/height bands, bike weight vs. experience); returns pass/fail/unknown per rule with the numbers used.
- `tools/cost_estimator.py` + `CostEstimatorService`: total-cost-of-ownership estimate from purchase price band plus a heuristic coefficient table (insurance class, consumption, maintenance interval) kept as a versioned Python/YAML constant — simplest viable choice, no external pricing API; result labels itself an estimate.
- Name→bike resolution helper (exact + trigram/ILIKE match on approved models) shared by all tools; unresolved names return a structured "unknown bike" result (step 3.4 turns this into a backlog flag).
- Typer command `app tools run <tool-name> --args '<json>'` to invoke any tool directly.
- Unit tests per tool: A2 boundary cases (35.0 kW, ratio exactly 0.2), comparison with missing specs, estimator determinism.
- Agent assignment: **backend-dev**.

## Verification

- `app tools run licence_fit_check --args '{"motorbikeName":"Suzuki GSR 600","licence":"A2","riderHeightCm":165}'` returns a structured verdict citing verified power/weight figures; same pattern for the other three tools.

## Risks / notes

- Cost heuristics can look authoritative — the result schema must carry an `assumptions` field the UI can show; get the coefficient table sanity-checked once.
- Missing verified specs must yield "unknown", never a guessed value; tools read verified specs only, never drafts.
