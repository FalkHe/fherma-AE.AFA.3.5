# Phase 4 — Open Questions

Unresolved issues blocking or endangering pinned Phase-4 contracts. Each
entry carries the surrounding knowledge an agent needs to resolve it.
**Resolved questions are removed from this file** and their outcome is
pinned in [`shared-knowledge.md`](shared-knowledge.md).

---

*(none open)*

---

## Resolved (2026-08-28) — recorded for the audit trail

- **OQ1 (adopt step 4.5?)**: owner confirmed 4.5 stays — the migration-free
  `SELECT … FOR UPDATE` lock is the least-effort fix for a rarely-reachable
  race. Pinned in `shared-knowledge.md` D7.
- **OQ2 (demo-data gap, Phase-3 N1 carry-over)**: owner chose **guessed
  demo prices** over research (research deferred, see below). Seeded
  directly in the dev DB on all 3 approved models, draft *and* verified
  rows (BMW S 1000 XR 18 500 € premium · Honda CB500F 6 800 € mid · Suzuki
  GSR600 4 200 € budget). Price sort, `filter[priceBand]` and the price
  chip are now demoable. **Follow-up (post-Phase-4):** replace the guesses
  with researched prices via the Phase-2 review flow — the values are
  plausible but unverified, and 4.10's docs must not present them as
  verified market data.
- **OQ3 (dispatch gate)**: satisfied — `phase-3-done` is tagged; Phase-4
  dev steps may dispatch.

## Resolved at slicing time (2026-08-28) — recorded for the audit trail

- **Step-4.2 scope conflict with the Phase-2 pin** ("all Phase-2 endpoints
  are admin-only, reads included"): 4.2's outline bullet "ensure
  `/api/products` serves non-admin users only approved models" is
  **superseded by decision D1** — customer reads go through the new
  `catalogue-models` resource; `/api/products` stays admin-only. No pinned
  contract is violated.
- **Manufacturers exposure**: relaxing `GET /api/manufacturers` to
  `current_user` (D2) exercises exactly the decision Phase 2b reserved for
  step 4.2 — a sanctioned resolution, not a pin change.
- **`:productId` vs `:motorbikeId`**: the Phase-3 reserved href contract
  (`/catalogue/:motorbikeId`, ULID) wins over step-4.2's `:productId`
  wording (D5).
- **Designer/architect reconciliation** (ui-spec §12): SPA URL params (short
  names) + one hook-owned mapping to the frozen wire names; query-key
  namespace `["catalogue", …]`; full filter parity in the UI panel; prose =
  single nullable Wikipedia `article`; i18n enum-label hoist to
  `common.specEnums.*` approved (touches one admin frontend file in 4.7).
