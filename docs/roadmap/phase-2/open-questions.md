# Phase 2 — Open Questions

Unresolved issues blocking or endangering pinned Phase-2 contracts. Each entry
carries the surrounding knowledge an agent needs to resolve it. **Resolved
questions are removed from this file** and their outcome is pinned in
[`shared-knowledge.md`](shared-knowledge.md).

---

**No open questions.** (2026-08-26)

All five questions raised during the Phase-2 planning review were resolved
the same day via web-verified research and pinned into `shared-knowledge.md`:

- OpenRouter embeddings endpoint → exists, serves
  `openai/text-embedding-3-small` (1536-dim native) — pinned in *LLM
  decisions*.
- `langchain-openrouter` → official langchain-ai package, `ChatOpenRouter`
  pinned for chat; embeddings via `langchain_openai.OpenAIEmbeddings` against
  OpenRouter with `check_embedding_ctx_length=False` — pinned in *LLM
  decisions* + dependency table.
- Taskiq retry middleware → `SmartRetryMiddleware` with
  `types_of_exceptions=[TransientJobError]` — pinned in *Taskiq wiring*.
- Tavily API shape → Bearer-header auth, `results[].url/title` — pinned in
  *Ingestion decisions*.
- Wikipedia image attribution → `pageimages` + Commons
  `imageinfo/extmetadata` chain (Artist/Credit are HTML, strip before
  storing; null attribution → UI fallback) — pinned in *Ingestion decisions*
  and ui-spec §9.

---

**Deferred hardening item for Phase 5.1** (found by QA on step 2.10/2.11,
2026-08-26): `storage.save_raw_document` performs no path-traversal defense
on `motorbike_id`/`document_id` (a `../`-bearing id escapes `DATA_DIR`).
Unreachable today — both ids are server-minted ULIDs — but the module itself
enforces nothing. Phase 5.1's validation sweep must add a resolve-and-verify
guard (QA regression tests already exist in
`backend/tests/services/ingestion/test_storage_qa.py`).
