# Demo walkthrough

Two demo assets exist. Pick whichever fits:

- **`backend/scripts/demo_conversation.py`** — a scripted, self-cleaning demo
  over the real HTTP API. It registers a throwaway account, drives an
  eight-turn interview and asserts the phase's grading-relevant behaviour
  (≥3 distinct tool calls, sources on retrieved knowledge, recommendations
  pointing at approved models, exactly one backlog row for an uncatalogued
  bike, resumability). Run it with:

  ```bash
  docker compose exec app-web python scripts/demo_conversation.py
  ```

  Read the script's own module docstring for what it asserts and why. It
  deletes everything it created when it finishes (or fails), so there is
  nothing left afterwards to click through in a browser.

- **This document** — a browser-replayable walkthrough for a human grader:
  sign in, have a short consultation, then browse the catalogue the advisor
  draws its recommendations from, including the out-of-chat sources/provenance
  surface. Every URL, curl command and expected outcome below was replayed
  against the running stack at `HEAD aa1f108` (tags `phase-4-m1`/`phase-4-m2`)
  on 2026-08-28.

## Prerequisites

- Stack up: `make up` (or `docker compose up -d`).
- Frontend: <http://localhost:5173>, backend API: <http://localhost:8000>.
- The seeded dev catalogue holds exactly **3 approved models** — every count
  and name below assumes this seed and will differ on another database:

  | Model | ULID | Category | Price band | `msrpEur` | A2-eligible |
  |---|---|---|---|---|---|
  | Suzuki GSR600 | `01M10WSCDCVD8P5AG7AWVEXWJK` | Naked | Budget | 4 200 | — (null) |
  | Honda CB500F | `01M10YCXRBW5ANBJT5MK638EK5` | Naked | Mid | 6 800 | Yes |
  | BMW S 1000 XR | `01M112N358BYCK15Y6E3ZGS75V` | Sport touring | Premium | 18 500 | — (null) |

**Price caveat:** `msrpEur`/`priceBand` on all three models are
owner-approved demo guesses seeded directly in the dev database, **not
researched market prices** — good enough to demo price sort, the
`priceBand` filter and the price chip, not to cite as fact. Real price
research is deferred past Phase 4 (see
`docs/roadmap/phase-4/shared-knowledge.md`, resolved OQ2).

## 1. Sign in as a plain user

Open <http://localhost:5173/register> and register a throwaway account:

- Username: 3–32 chars, lowercase letters/digits/`_`/`.`/`-` only (e.g.
  `demo-catalogue`).
- Password / confirm password: 8+ chars, identical.

Submitting redirects straight into the app at `/consultations` (registration
signs you in).

## 2. A short consultation → a recommendation card

Click **"Ask the advisor"** (or go directly to `/consultations` and start a
new one). The advisor greets first. Send these turns one at a time, waiting
for each reply before sending the next (the composer disables itself while a
reply is in flight):

1. `Hi! I passed my A2 test last month and this would be my first own bike.`
2. `I ride to work almost every day, about 20 km each way through city traffic, plus the occasional Sunday tour.`
3. `I am 1.72 m tall with an inside leg of roughly 80 cm, and I would like to stay around 6000 euro.`
4. `Alright — please show me your shortlist, even if it is only one bike.`

With only one A2-eligible approved model in the seed (Honda CB500F), turn 4
should present a single recommendation card for it. **The advisor is a live,
non-deterministic LLM** — wording varies every run, and occasionally a turn
needs a repeat before the card appears (`demo_conversation.py` retries once
for the same reason). If no card appears, resend turn 4 once before treating
it as a defect.

Leave this consultation open — chapter 4 below returns to its recommendation
card.

## 3. Catalogue chapter

### 3.1 Open the catalogue

Click **Catalogue** in the top nav (between Consultations and Admin), or go
directly to <http://localhost:5173/catalogue>. All 3 approved models render
as cards; nothing else in the database is visible here (backlog/in-review/
rejected rows are excluded server-side, for every role).

### 3.2 Apply a filter combination that visibly narrows

In the filter panel (sidebar on desktop, **Filters** button drawer below the
`md` breakpoint), set:

- Category → **Naked**
- Engine displacement (cc) → min `400`, max `700`
- Max seat height (mm) → `800`

The result count drops from 3 to **2 models**: Honda CB500F and Suzuki
GSR600 (BMW S 1000 XR is Sport touring and drops out on category alone).
Each control applies immediately — no Apply button.

### 3.3 Copy/reload the URL

The address bar now reads:

```
http://localhost:5173/catalogue?category=naked&ccMin=400&ccMax=700&seatMax=800
```

Copy that URL, open it in a fresh tab (or reload the page). The two filter
controls (Category, Engine cc min/max, Max seat height) reappear pre-filled
and the grid still shows the same 2 models — the URL is the only state.
Signing out first and pasting the URL into the login flow also works: `main`
now preserves the query string through the redirect (`RequireAuth` passes
the full `location`, including `search`, and `LoginRoute` reads
`from.pathname + from.search` — this was an open defect at the end of step
4.9, fixed at `HEAD aa1f108`).

### 3.4 Open a model detail page

Click the **Honda CB500F** card. URL:
<http://localhost:5173/catalogue/01M10YCXRBW5ANBJT5MK638EK5>. The page
shows, top to bottom:

- **Verified specs** — a grouped table (Engine & performance, Dimensions &
  ergonomics, Licence & safety, Classification & price) of the 13 frozen
  spec fields; null fields render no row at all (never a dash on this
  surface).
- **About this bike** — the Wikipedia article's markdown prose (headings,
  tables, references) — the *only* prose customers see; scraped
  product/magazine pages never render wholesale here.
- **Sources** — a permanently expanded panel (never a collapsible toggle)
  listing every retrieved document's title + external link, e.g. "Honda 500
  twins" → `en.wikipedia.org`, plus magazine/review sources such as
  CarThrottle and Cycle World. This is the out-of-chat provenance surface —
  it exists independently of any chat conversation.
- **Image + attribution** — the approved photo with its licence attribution
  string rendered visibly beneath it (e.g. "Chanokchon · CC BY-SA 4.0 · …").

### 3.5 Sort by price

Back on `/catalogue`, clear the filters and set **Sort by → Price (low to
high)** (URL gains `&sort=price`, mapped server-side to `msrpEur` ascending,
NULLS LAST). Order: **Suzuki GSR600 (€4,200) → Honda CB500F (€6,800) → BMW S
1000 XR (€18,500)**.

### 3.6 A non-approved id 404s

Visit <http://localhost:5173/catalogue/01M12M1GVVSM3K1QFQF44YXMK0> directly
(a real backlog-status row, not a random string). The page shows the "Model
not found" empty state, not a leaked draft — unknown and non-approved ids are
indistinguishable, by design.

## 4. Recommendation-card click-through

Return to the consultation opened in chapter 2 (`/consultations` → the
chat). Click the **Honda CB500F** recommendation card. It navigates to
<http://localhost:5173/catalogue/01M10YCXRBW5ANBJT5MK638EK5> — the identical
detail page from §3.4, specs/article/sources/attribution and all. The whole
card surface is a real link (`Ctrl`/`Cmd`-click or middle-click opens it in a
new tab too).

## 5. Role-scoping curl replay

Graders who want to prove the security story without the UI can replay this
directly against the API. Each snippet is self-contained (uses a cookie jar
file for the session):

```bash
# 1. Register a throwaway account and sign in (cookie jar captures the session).
curl -s -c cookies.txt -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"demo410-curl","password":"a-long-enough-password"}'
# -> 201, {"id":"...","username":"demo410-curl","role":"user"}

curl -s -c cookies.txt -b cookies.txt -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"demo410-curl","password":"a-long-enough-password","rememberMe":false}'
# -> 200, {"id":"...","username":"demo410-curl","role":"user"}

# 2. A plain user CAN read the customer catalogue resource.
curl -s -b cookies.txt http://localhost:8000/api/catalogue-models -o /dev/null -w '%{http_code}\n'
# -> 200

# 3. A plain user CANNOT read the admin-only products resource
#    (the Phase-2 pin: all Phase-2 endpoints stay admin-only, reads included).
curl -s -b cookies.txt http://localhost:8000/api/products -o /dev/null -w '%{http_code}\n'
# -> 403 {"detail":"Admin privileges required."}

# 4. A non-approved id 404s on the customer detail endpoint (no existence leak
#    between "unknown" and "exists but not approved").
curl -s -b cookies.txt http://localhost:8000/api/catalogue-models/01M12M1GVVSM3K1QFQF44YXMK0 \
  -o /dev/null -w '%{http_code}\n'
# -> 404

# 5. The filter combination from §3.2, over the wire (JSON:API filter names).
curl -s -b cookies.txt \
  "http://localhost:8000/api/catalogue-models?filter[category]=naked&filter[engineCcMin]=400&filter[engineCcMax]=700&filter[seatHeightMmMax]=800"
# -> 200, meta.totalCount: 2 (Honda CB500F, Suzuki GSR600)
```

Registering repeatedly with the same username 409s on step 1 — change the
username, or delete the throwaway row afterwards to leave the database
exactly as found:

```bash
docker compose exec postgres psql -U app -d application \
  -c "DELETE FROM users WHERE username = 'demo410-curl';"
```

(`ON DELETE CASCADE` removes the account's chats/messages/preferences with
it.) `demo_conversation.py` does the equivalent cleanup automatically for
its own throwaway account.

## Notes for a fresh reader

- Chapters 1–4 assume the seed in the prerequisites table. A different
  dev/CI database will narrow to different counts at the same filter
  values — the *mechanism* (filter narrows the grid, URL round-trips,
  detail page renders specs/prose/sources/attribution, cards link through)
  is what's being demonstrated, not the exact numbers.
- Chapter 2's turn wording is illustrative, not exact-match required — any
  phrasing that establishes A2 licence + budget ≈ €6,000 and then asks for a
  shortlist reaches the same one-model result, because it is currently the
  only A2-eligible approved model.
- The price values throughout (chapters 3.4, 3.5, 5) are demo guesses, not
  verified market data — see the caveat in Prerequisites.
