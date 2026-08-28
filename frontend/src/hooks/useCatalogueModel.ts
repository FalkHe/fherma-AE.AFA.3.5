import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { queryKeys } from "../queryKeys";

import type { PriceBand, SpecCategory } from "./useCatalogueFilters";

/**
 * STUB — the whole file is replaced wholesale in step 4.9, when
 * `GET /api/catalogue-models/{motorbikeId}` reaches the generated API client.
 * The exported names, the argument shape, the returned detail shape and the
 * query key are pinned by `docs/roadmap/phase-4/shared-knowledge.md`
 * (§Frontend conventions — delta); do not change them, and do not import
 * anything from here that 4.9 will not still export (`useCatalogueModel`,
 * `CatalogueModelDetail`, `CatalogueImage`, `ModelSource`, `CatalogueError`).
 *
 * What is real here: the TanStack Query plumbing and the error shape. The hook
 * returns a genuine `useQuery` result — same key, same 404-vs-network branch the
 * route reads — over an in-memory fixture set that answers **404 for every id it
 * does not know**, exactly as the endpoint does for unknown *and* unapproved
 * models (no existence leak, ui-spec R6).
 *
 * The fixtures stand on their own: `useCatalogueModels.ts` carries a separate
 * list fixture set (both die together in 4.9). The two overlap in one id — the
 * fully-populated Suzuki GSR 600 — so the grid's click-through has a destination
 * that agrees with its card.
 */

// --- Contract types (survive 4.9) ------------------------------------------

/**
 * One approved image, in the wire's own variant keys (`ImageVariants` plus the
 * attribution), so 4.9's generated types replace this declaration without a
 * single edit in `ModelImageGallery`.
 */
export interface CatalogueImage {
  thumb: string;
  card: string;
  detail: string;
  /** Licence line; shown verbatim wherever the image is published. */
  attribution: string | null;
}

/** One retrieved document behind the page — the out-of-chat provenance row. */
export interface ModelSource {
  sourceTitle: string;
  /** `null` for an uploaded document: a row without a link, never a dead one. */
  sourceUrl: string | null;
}

/**
 * Everything the detail page renders (ui-spec §4.6 "data needs").
 *
 * `specs` holds the **13 frozen fields**, every one of them explicitly nullable:
 * an approved model without a verified revision answers 13 nulls, and the table
 * omits what it does not know rather than guessing it.
 */
export interface CatalogueModelDetail {
  motorbikeId: string;
  name: string;
  manufacturer: string | null;
  specs: {
    category: SpecCategory | null;
    engineCc: number | null;
    cylinders: number | null;
    powerKw: number | null;
    torqueNm: number | null;
    wetWeightKg: number | null;
    seatHeightMm: number | null;
    tankCapacityL: number | null;
    topSpeedKmh: number | null;
    abs: boolean | null;
    a2Eligible: boolean | null;
    priceBand: PriceBand | null;
    msrpEur: number | null;
  };
  /** The Wikipedia document's markdown, or `null` when there is no prose. */
  article: string | null;
  sources: ModelSource[];
  /** Approved images, newest first — possibly none. */
  images: CatalogueImage[];
}

/**
 * A failed catalogue read.
 *
 * Same shape and rationale as `ProductError`: the backend's `detail` is English
 * prose for developers, so the screen decides its own message from the status —
 * 404 (unknown *or* unapproved) is the not-found state, everything else is the
 * retryable failure. Never branch on message text.
 */
export class CatalogueError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null = null) {
    super(`Catalogue request failed with status ${status}`);
    this.name = "CatalogueError";
    this.status = status;
    this.code = code;
  }
}

// --- Stub server (deleted in 4.9) ------------------------------------------

/** Fixture ids, 26 characters like the ULID primary keys they stand in for. */
function stubId(label: string): string {
  return `01STUB${label.toUpperCase()}`.padEnd(26, "0").slice(0, 26);
}

/**
 * The three fixture ids, exercised by the tests and by the manual walk-through:
 * a fully-populated model, a sparse one, and one that is not in the catalogue.
 */
const FIXTURE_IDS = {
  full: stubId("suzukigsr600"),
  sparse: stubId("hondarebel500"),
  missing: stubId("missing"),
} as const;

/**
 * Server-relative `/media/…` URLs resolve against Vite in development, where the
 * API lives on another origin — same prefix convention as `api/client.ts`.
 */
const mediaBase: string = import.meta.env.VITE_API_URL ?? "";

/**
 * Real approved images from the development media directory, so the gallery
 * renders actual photographs while the endpoint is still missing. The variant
 * URLs are spelled out the way the API computes them
 * (`…_{thumb,card,detail}.webp`).
 */
function imageVariants(cardPath: string, attribution: string | null): CatalogueImage {
  return {
    thumb: mediaBase + cardPath.replace(/_card\.webp$/, "_thumb.webp"),
    card: mediaBase + cardPath,
    detail: mediaBase + cardPath.replace(/_card\.webp$/, "_detail.webp"),
    attribution,
  };
}

/**
 * Two `##` sections, a GFM table and an inline `<script>`: the fixture that
 * proves the pinned markdown configuration. Raw HTML is **off**, so the script
 * tag reaches the page as text and never as an element — this is retrieved web
 * content, and the article block is where that rule has to hold.
 */
const GSR600_ARTICLE = `The **Suzuki GSR 600** is a naked bike built from 2006 to 2011, using a
detuned version of the [GSX-R600](https://en.wikipedia.org/wiki/Suzuki_GSX-R600)
inline-four. <script>window.__catalogueStubPwned = true;</script>

## Design

The GSR 600 pairs a bikini fairing with an underseat exhaust; the riding
position is upright, and the frame is a twin-spar aluminium unit.

| Year | Change |
| --- | --- |
| 2006 | Launched in Europe |
| 2007 | ABS offered as an option |
| 2011 | Replaced by the GSR 750 |

## Reception

Reviewers praised the engine's mid-range and the low seat height, while
criticising the budget suspension on early bikes.`;

const FIXTURES: readonly CatalogueModelDetail[] = [
  {
    motorbikeId: FIXTURE_IDS.full,
    name: "Suzuki GSR 600",
    manufacturer: "Suzuki",
    // 13 of 13 — every group renders, both boolean spellings appear.
    specs: {
      category: "naked",
      engineCc: 599,
      cylinders: 4,
      powerKw: 72.5,
      torqueNm: 63.5,
      wetWeightKg: 197,
      seatHeightMm: 785,
      tankCapacityL: 16.5,
      topSpeedKmh: 230,
      abs: true,
      a2Eligible: false,
      priceBand: "budget",
      msrpEur: 4200,
    },
    article: GSR600_ARTICLE,
    // Three rows, two of which are the interesting ones: an upload without a
    // URL, and a duplicate of the Wikipedia URL that de-duplication removes.
    sources: [
      {
        sourceTitle: "Suzuki GSR600 — Wikipedia",
        sourceUrl: "https://en.wikipedia.org/wiki/Suzuki_GSR600",
      },
      {
        sourceTitle: "Suzuki GSR600 (mirror)",
        sourceUrl: "https://en.wikipedia.org/wiki/Suzuki_GSR600",
      },
      { sourceTitle: "Owner's manual (uploaded)", sourceUrl: null },
    ],
    images: [
      imageVariants(
        "/media/motorbikes/01M10WSCDCVD8P5AG7AWVEXWJK/01M10WSKNMZ3ZP9FEX7JPMQ7AW_card.webp",
        "Photo: Wikimedia Commons, CC BY-SA 4.0",
      ),
      imageVariants(
        "/media/motorbikes/01M112N358BYCK15Y6E3ZGS75V/01M112P80J0ZKG35ZDMVASJZVB_card.webp",
        null,
      ),
    ],
  },
  {
    motorbikeId: FIXTURE_IDS.sparse,
    name: "Honda Rebel 500",
    manufacturer: "Honda",
    // Partial extraction: the "Licence & safety" group is entirely unknown, so
    // it renders no header at all, and the unknown fields render no rows.
    specs: {
      category: "cruiser",
      engineCc: 471,
      cylinders: null,
      powerKw: 34,
      torqueNm: null,
      wetWeightKg: 191,
      seatHeightMm: 690,
      tankCapacityL: null,
      topSpeedKmh: null,
      abs: null,
      a2Eligible: null,
      priceBand: "mid",
      msrpEur: 6500,
    },
    article: null,
    sources: [
      {
        sourceTitle: "Honda Rebel 500 — Wikipedia",
        sourceUrl: "https://en.wikipedia.org/wiki/Honda_Rebel",
      },
    ],
    images: [],
  },
];

const FIXTURES_BY_ID = new Map(FIXTURES.map((model) => [model.motorbikeId, model]));

/** Round trip long enough to make the page skeletons visible. */
const STUB_LATENCY_MS = 250;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * What the endpoint will do: answer the approved model, or 404 `not-found` for
 * anything else — unknown, backlog, in review and rejected are deliberately
 * indistinguishable.
 */
async function getModel(motorbikeId: string): Promise<CatalogueModelDetail> {
  await sleep(STUB_LATENCY_MS);

  const model = FIXTURES_BY_ID.get(motorbikeId);

  if (model === undefined) {
    throw new CatalogueError(404, "not-found");
  }

  return model;
}

// --- Hook (survives 4.9) ---------------------------------------------------

/**
 * One approved model with everything the detail page shows: specs, prose,
 * sources and images.
 *
 * The route param can be empty for a fraction of a render, and asking the API
 * for model "" would answer 404 and show the wrong state — hence the guard.
 */
export function useCatalogueModel(
  motorbikeId: string,
): UseQueryResult<CatalogueModelDetail, Error> {
  return useQuery({
    queryKey: queryKeys.catalogue.detail(motorbikeId),
    queryFn: () => getModel(motorbikeId),
    enabled: motorbikeId !== "",
  });
}
