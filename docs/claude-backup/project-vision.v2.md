# Project Vision — Motorcycle Buying Advisor

**Status:** Vision agreed, specification and implementation open
**Domain:** EU motorcycle purchase advice
**Date:** August 2026

---

## 1. The Problem

Choosing a motorcycle is a badly-served decision. The buyer faces a large field of models constrained by licence category, budget, physical fit, and intended use, and the available advice is either forum opinion, dealer incentive, or spec sheets with no interpretation layer.

Two kinds of information matter, and they live in different places. **Hard facts** — what a machine weighs, costs, and produces — are tabular and comparable. **Character** — how a bike is regarded, what it is like to live with, what tends to go wrong — exists only as prose. Buyers need both, and no single source provides them together.

## 2. The Product

A conversational advisor that interviews the buyer, then recommends models by combining verified specification data with retrieved prose about how those machines are actually regarded.

The central commitment is **honouring the firmness of a stated preference**. When someone says "I need an A2-legal bike," that is absolute. When they say "I'd like something around 600cc, but it could be more or less," that is a soft target, and treating it as a filter would be wrong. The system must tell the two apart and act accordingly.

The second commitment is that the advice **argues its case**. A recommendation arrives with its reasoning attached — which preferences drove it, where one was traded against another, and what the claim rests on. The user should be able to disagree with the reasoning, not just the result.

### User journey

1. The user opens with an open question — "what motorbike should I buy?"
2. The assistant interviews them conversationally, gathering what matters.
3. Absolute constraints narrow the field. Flexible preferences shape the ranking rather than eliminating candidates.
4. A shortlist is returned with its reasoning shown.
5. The user interrogates individual candidates. Factual questions are answered from verified data; questions of character and reputation are answered from prose, with sources shown.

---

## 3. Principles

### 3.1 Two sources, separated by trust

A **curated specification set** covering roughly 150 EU-market models, all classes, is the source of truth for anything numeric. It is the only thing the system will quote figures from.

**Article prose** about those models is the second source, supplying what a specification table cannot: character, reputation, known issues, generational context. It is retrieved by relevance and cited. It never supplies numbers.

Keeping these apart is what makes the advice both trustworthy and interesting. Facts come from a source that can be checked; judgement comes from a source that can be read.

### 3.2 Incomplete data must not distort advice

Coverage will be uneven. Some models will carry more information than others. A model must never rank lower simply because less is known about it, and the system should be candid about where its picture is thin rather than presenting a partial view as a complete one.

### 3.3 Absolute versus flexible

Constraints that cannot bend — licence eligibility above all — remove candidates from consideration. Preferences that can bend influence ranking without excluding anything.

A formally calculable decision matrix is not a requirement. What matters is that a flexible preference behaves flexibly and an absolute one does not.

### 3.4 The catalogue grows, but only deliberately

The catalogue is finite and the world is not. Models will come up that it does not hold — raised by the user, or encountered while reading about something else. The system records these rather than failing silently or improvising specifications, and it can honestly tell the user that a model sits outside what it knows.

Nothing reaches the user on the strength of that capture alone. An entry becomes advisable only once a human has researched and approved it. Automated capture feeds a backlog; it never feeds a recommendation.

---

## 4. Guardrails

**Never recommend a bike the user cannot legally ride.** Licence eligibility is absolute, not a scored preference.

**Never invent a specification.** Every figure originates in the verified data. The model does not supply numbers from memory.

**Treat retrieved text as data, not instruction.** Article prose entering the system is untrusted input.

**Nothing unverified becomes advice.** Automatically captured models are not recommended until reviewed by a human.

**Stay in domain.** Off-domain requests are declined.

---

## 5. Open Questions

Unresolved by design, to be settled during specification:

- **The attribute set.** Which rider attributes the interview gathers, and which specification fields the system reasons over.
- **Data coverage.** Which fields can be captured reliably, and which require manual work.
- **Preference mechanism.** How soft preferences influence ranking in practice.
- **Capability set.** Which discrete functions the assistant can invoke, beyond conversation and retrieval.

## 6. Open Risks

**Data yield.** If specification data proves harder to gather than expected, the attribute set shrinks and with it the sophistication of the advice. This is the risk most worth resolving early, because it drives everything downstream.

**Live market data.** Access to current listing prices would strengthen the advice considerably. Whether legitimate access exists is unverified, so it is treated as an enhancement rather than a dependency.

---

## 7. Out of Scope

- Dealer inventory, availability, or purchase facilitation
- Financing, leasing, or insurance quotation
- Gear, maintenance, or riding-technique advice
- Non-EU markets and licence regimes

---

## Appendix — Requirements Coverage

Recorded for assignment compliance. Implementation choices sit outside this document.

| Requirement | Where addressed |
|---|---|
| RAG over a domain knowledge base | §3.1 — article prose as a retrieved, cited source |
| Three or more domain-relevant tool calls | §5 — capability set open; spans lookup, legal evaluation, selection, and capture |
| Domain specialisation | §1–§4 — EU motorcycle purchasing, curated knowledge base, five guardrails |
| LangChain with OpenRouter | Implementation decision, agreed and recorded separately |
| Error handling and input validation | §3.2 — incomplete data handling; validation at point of capture |
| Interface with sources, tool results, progress | §2 — visible reasoning and cited sources are product commitments |
