# Phase 3 — Open Questions

Unresolved issues blocking or endangering pinned Phase-3 contracts. Each
entry carries the surrounding knowledge an agent needs to resolve it.
**Resolved questions are removed from this file** and their outcome is
pinned in [`shared-knowledge.md`](shared-knowledge.md).

---

**No open questions.** (2026-08-27)

All items raised during the Phase-3 slicing were resolved by the owner the
same day and pinned:

- **D1 (phase rescope)** — accepted: the consultation UI (former step 4.1)
  lives in Phase 3's frontend track; Phase 4 keeps catalogue browsing —
  pinned in shared-knowledge's scope note and `roadmap.md`.
- **Q1 (models)** — the advisor gets its own `ADVISOR_MODEL` config key
  (added in 3.5; responder + agent loop); `CHAT_MODEL` stays the
  ingestion/extraction + utility model (query translation included). Exact
  model ids are `.env` values and may change — never hardcoded, never
  asserted in tests — pinned in shared-knowledge *Config keys* and *Chat
  response job*.
- **Q2 (who speaks first)** — the advisor greets and asks an opening
  question, like a seller in a real store; but a chat is only ever created
  by the explicit "Ask the advisor" button, never on page load. Pinned in
  shared-knowledge (*JSON:API resources* → `POST /api/chats`, *Chat
  response job*) and ui-spec §4/§5/§14.
- **Q3 (deletion)** — soft delete: `deleted_at` on `chats` (3.1),
  `DELETE /api/chats/{id}` (3.3), list affordance + confirm dialog
  (3.4/3.6). No restore UI. Pinned in shared-knowledge *DB schema* +
  *JSON:API resources* and ui-spec §4.
- **A1 (working tree)** — resolved: tree clean except the Phase-3 planning
  docs (committed at slicing end).
- **A2 (approved models for M3)** — resolved: DB prepared with approved,
  embedded models.
