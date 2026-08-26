---
phase: 4
step: "4.1"
title: Consultation UI
summary: The customer-facing chat experience — a consultation list to start/resume conversations, and a chat view rendering markdown replies, cited sources, tool-call results, and recommendation cards, with seen/typing states driven by SSE.
effort: 16
dependencies: ["0.2", "1.1", "1.3", "2.2", "3.4", "4.2"]
---

# Step 4.1 — Consultation UI

**Effort: 16** — several distinct UI surfaces (list, chat timeline, four tool-result renderers, cards, sources) plus an SSE-driven state machine and a small backend serialization contract; roughly two to three agent sessions.

Note: step 4.2's detail page is the link target for recommendation cards — build 4.2 (or at least its detail page) first; it's the cheaper, lower-risk slice.

## Architect's outline

- **Backend message-part contract** (backend-dev, do first, tiny): extend the JSON:API `chat-messages` serialization so an assistant message exposes structured parts already persisted in Phase 3: markdown `body`, `sources[]` (sourceTitle, sourceUrl, headingPath), `toolCalls[]` (tool name, input summary, structured result), `recommendations[]` (productId, name, imageUrl, one-line rationale, key specs). Also expose `activeOperationId` on the `chats` resource so a reloaded page knows the assistant is still "typing". Regenerate API types.
- **Consultation list page** (frontend-dev): `ConsultationListPage.tsx` at `/consultations` (also the post-login home) — TanStack Query on `/api/chats`, MUI list with title/last-activity, "New consultation" button (POST → navigate), empty state.
- **Chat view route & data**: `ConsultationPage.tsx` at `/consultations/:chatId`; messages via `/api/chat-messages?filter[chat]=…`; composer posting with optimistic append of the user message.
- **SSE → chat state machine**: handle `operation.updated` and `chat.message.created` in the existing EventSource hook: user message accepted → "seen ✓"; operation `running` → typing indicator bubble; `chat.message.created` → invalidate messages query, indicator disappears. On mount/reconnect, derive pending state from `activeOperationId` so resume-after-close shows the correct state. No token streaming (per architecture).
- **Message rendering**: `MessageBubble.tsx` using react-markdown + remark-gfm with raw HTML disabled; distinct user/assistant styling; timestamps via `Intl`.
- **Sources display** (grading-critical): `MessageSources.tsx` — collapsible "Sources" section under assistant messages listing title + external link per provenance entry.
- **Tool-call result renderers** (grading-critical): `toolResults/` with one component per domain tool — catalogue search (compact result list), spec comparison (MUI table), licence/fit check (pass/fail chips with reasons), cost estimator (line-item breakdown) — plus a generic key/value fallback. Each labelled with the tool name so graders see tool calls explicitly.
- **Recommendation cards**: `RecommendationCard.tsx` — MUI Card with product image (`srcset`, lazy), name, 3–4 key verified specs, rationale line, linking to the step-4.2 detail route.
- **UX pass** (ui-ux-designer, one short session): chat layout, typing-indicator affordance, mobile behaviour of comparison tables (horizontal scroll), i18n keys.
- **QA** (qa): the phase's done-when script — fresh register → interview → cards → close browser → resume — confirming sources, tool results, and typing indicator all visibly appear.

## Verification

- `curl` a chat with a tool-calling turn shows all message parts in the JSON; the QA end-to-end script passes.

## Risks / notes

- The message-part schema is the load-bearing contract; agree on it before any frontend work, or the four renderers get built against guesswork.
- "Seen" has no natural backend event — simplest viable choice: treat the successful POST response as "seen" rather than inventing a new SSE event.
- Comparison tables inside chat bubbles are the layout risk on narrow viewports; plan horizontal scroll from the start.
