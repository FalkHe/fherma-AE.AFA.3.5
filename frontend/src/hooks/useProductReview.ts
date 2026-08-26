import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import type { components } from "../api/schema";
import { queryKeys } from "../queryKeys";

import type { Product } from "./useProducts";

/**
 * STUB — replaced wholesale by step 2.20, which wires these five hooks to
 * `GET /api/products/{id}`, `GET /api/documents`, `GET /api/product-images` and
 * their `PATCH`es through the generated client. Nothing outside this file may
 * know that the review screen currently runs on fixtures: the hooks return real
 * `useQuery`/`useMutation` results, keyed with the pinned query keys, so the
 * components written against them survive the replacement unchanged.
 *
 * Two deliberate stub behaviours:
 *
 * - `useProduct` answers with the fixture for **any** id, echoing back the id it
 *   was asked for. The route param therefore stays the real catalogue id, which
 *   matters because `useTransitionProduct` (step 2.15, already live) sends its
 *   approve/reject `PATCH` to the real API.
 * - The fixture store is mutable, as in the step-2.8 stubs: saving a draft spec
 *   and rejecting the image really change it, so both flows are observable —
 *   the mutations invalidate their queries and the screen re-reads the store.
 *
 * The product's `status` comes from the fixture, so a gate of §6 is reached by
 * editing `FIXTURE_PRODUCT.status` (the step's pinned verification path).
 */

/** A specification revision as the API returns it (`draftSpec`/`verifiedSpec`). */
export type DraftSpec = components["schemas"]["SpecAttributes"];

/** Provenance class of a source document (`source_type` in the catalogue). */
export type SourceType = "wikipedia" | "product" | "technical" | "magazine" | "upload";

/**
 * One retrieved source document, flattened out of its JSON:API envelope exactly
 * as `Product` is — components never see `.attributes`.
 *
 * Typed by hand because the documents endpoints are not in the generated schema
 * this step builds against; 2.20 replaces this with
 * `{ id: string } & components["schemas"]["DocumentAttributes"]`.
 */
export interface SourceDocument {
  id: string;
  sourceType: SourceType;
  /** `null` for uploads, which have no origin URL. */
  sourceUrl: string | null;
  sourceTitle: string;
  contentMarkdown: string;
  fetchedAt: string;
  createdAt: string;
}

/** Moderation state of a fetched image. */
export type ImageStatus = "pending" | "approved" | "rejected";

/**
 * The one image an ingestion run fetched, with its computed variant URLs
 * (`/media/motorbikes/{motorbikeId}/{imageId}_{variant}.webp` server-side).
 */
export interface ProductImage {
  id: string;
  sourceUrl: string;
  /** Licence/author line, `null` when Wikimedia carried no metadata. */
  attribution: string | null;
  status: ImageStatus;
  variants: { thumb: string; card: string; detail: string };
  createdAt: string;
}

/**
 * A failed draft-spec save.
 *
 * Same shape and rationale as Phase-1's `AuthError`: the screen decides its own
 * message from the status code, and `validationFields` carries the field names
 * out of a 422 body (`loc`'s last segment) so a rejected value can be shown on
 * the field it belongs to instead of as a general error. 2.20 keeps this class
 * and fills it from the real error document.
 */
export class SaveDraftSpecError extends Error {
  readonly status: number;
  readonly validationFields: readonly string[];

  constructor(status: number, validationFields: readonly string[] = []) {
    super(`Draft spec save failed with status ${status}`);
    this.name = "SaveDraftSpecError";
    this.status = status;
    this.validationFields = validationFields;
  }
}

/**
 * Fixture latency, so the pending states (save spinner, disabled reject dialog)
 * are observable instead of finishing within one frame.
 */
const STUB_LATENCY_MS = 350;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

/**
 * The Wikipedia article: headings plus a GFM table (proves the react-markdown
 * configuration) and a line of raw HTML that must render as visible text —
 * retrieved content stays inert, raw HTML is off.
 */
const WIKIPEDIA_MARKDOWN = `# Suzuki GSR 600

The **GSR 600** is a naked bike Suzuki built between 2006 and 2011. It uses a
detuned version of the GSX-R600 engine in a steel frame, with an upright riding
position aimed at everyday use.

## Technical data

| Specification | Value |
| --- | --- |
| Engine | 599 cm³ inline-four |
| Power | 72 kW at 12,000 rpm |
| Torque | 63 Nm at 10,000 rpm |
| Wet weight | 209 kg |
| Seat height | 785 mm |

## Reception

Reviewers praised the engine's top end and criticised the soft suspension.
Later model years added ABS as an option. See the
[manufacturer archive](https://example.invalid/suzuki/gsr600) for the original
brochure.

<b>Raw HTML is disabled</b> — this line and <script>alert("xss")</script> are
rendered as text, never as markup.
`;

const MAGAZINE_MARKDOWN = `## Long-term test: 12,000 km on a GSR 600

The motor is the highlight: smooth to 8,000 rpm, then genuinely quick. Fuel
consumption settled around 5.6 l/100 km on our route.

- Comfortable for two hours, then the seat foam gives up.
- Chain and sprockets lasted the whole test.
- The original tyres were the weakest part of the package.
`;

/**
 * Fixture product: an `in_review` model with a full draft spec that carries
 * nulls (`torqueNm`, `msrpEur`, …), which is what the form's null handling and
 * the three-state A2 select are built for.
 */
const FIXTURE_PRODUCT: Omit<Product, "id"> = {
  name: "Suzuki GSR 600",
  slug: "suzuki-gsr-600",
  manufacturer: "Suzuki",
  modelName: "GSR 600",
  yearFrom: 2006,
  yearTo: 2011,
  status: "in_review",
  draftSpec: {
    category: "naked",
    engineCc: 599,
    cylinders: 4,
    powerKw: 72,
    torqueNm: null,
    wetWeightKg: 209,
    seatHeightMm: 785,
    tankCapacityL: 16.5,
    topSpeedKmh: null,
    abs: false,
    a2Eligible: null,
    priceBand: "budget",
    msrpEur: null,
    extra: {
      frame: "Steel tube",
      "front suspension": "41 mm telescopic fork",
      gearbox: "6-speed",
      colours: ["black", "blue", "silver"],
    },
    sourceHints: { powerKw: "Wikipedia infobox", engineCc: "manufacturer brochure" },
    extractedAt: "2026-08-25T09:12:00Z",
  },
  verifiedSpec: null,
  createdAt: "2026-08-25T09:03:00Z",
  updatedAt: "2026-08-25T09:14:00Z",
};

const FIXTURE_DOCUMENTS: readonly SourceDocument[] = [
  {
    id: "01DOCUMENTWIKIPEDIA0000001",
    sourceType: "wikipedia",
    sourceUrl: "https://en.wikipedia.org/wiki/Suzuki_GSR600",
    sourceTitle: "Suzuki GSR600",
    contentMarkdown: WIKIPEDIA_MARKDOWN,
    fetchedAt: "2026-08-25T09:04:00Z",
    createdAt: "2026-08-25T09:04:01Z",
  },
  {
    id: "01DOCUMENTMAGAZINE00000001",
    sourceType: "magazine",
    sourceUrl: "https://example.invalid/reviews/suzuki-gsr-600-long-term",
    sourceTitle: "Suzuki GSR 600 — long-term test",
    contentMarkdown: MAGAZINE_MARKDOWN,
    fetchedAt: "2026-08-25T09:06:00Z",
    createdAt: "2026-08-25T09:06:02Z",
  },
];

/**
 * Fixture image: `pending` with attribution, as ingestion leaves it.
 *
 * The variant URLs are inline SVG data URIs rather than `/media/...` paths, so
 * the three previews actually render against fixture ids (no media file exists
 * for a fixture). 2.20 gets the computed URLs from the API.
 */
function placeholderVariant(width: number, height: number, label: string): string {
  // Fixture image *content*, not UI styling — hence the literal colours.
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}"`,
    ` height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="#37474f"/>`,
    `<text x="50%" y="50%" fill="#eceff1" font-family="sans-serif"`,
    ` font-size="${Math.round(width / 12)}" text-anchor="middle"`,
    ` dominant-baseline="middle">${label}</text></svg>`,
  ].join("");

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const FIXTURE_IMAGE: ProductImage = {
  id: "01IMAGEWIKIMEDIA000000001",
  sourceUrl:
    "https://upload.wikimedia.org/wikipedia/commons/3/3f/Suzuki_GSR600_2006.jpg",
  attribution:
    "Jane Doe · CC BY-SA 3.0 · https://creativecommons.org/licenses/by-sa/3.0",
  status: "pending",
  variants: {
    thumb: placeholderVariant(320, 213, "thumb 320"),
    card: placeholderVariant(640, 427, "card 640"),
    detail: placeholderVariant(1280, 853, "detail 1280"),
  },
  createdAt: "2026-08-25T09:11:00Z",
};

/** Mutable fixture store — the two mutations below really change it. */
const reviewStore: {
  product: Omit<Product, "id">;
  documents: readonly SourceDocument[];
  image: ProductImage | null;
} = {
  product: FIXTURE_PRODUCT,
  documents: FIXTURE_DOCUMENTS,
  image: FIXTURE_IMAGE,
};

/** `GET /api/products/{id}` — the shell of the review screen. */
export function useProduct(id: string): UseQueryResult<Product, Error> {
  return useQuery({
    queryKey: queryKeys.products.detail(id),
    queryFn: () => Promise.resolve({ id, ...reviewStore.product }),
    enabled: id !== "",
  });
}

/** `GET /api/documents?filter[product]=…` — Wikipedia first, then by age. */
export function useProductDocuments(
  productId: string,
): UseQueryResult<SourceDocument[], Error> {
  return useQuery({
    queryKey: queryKeys.documents.byProduct(productId),
    queryFn: () => Promise.resolve([...reviewStore.documents]),
    enabled: productId !== "",
  });
}

/**
 * `GET /api/product-images?filter[product]=…`, reduced to the newest image.
 *
 * `null` is a normal answer: ingestion stores at most one image per run and may
 * find none at all.
 */
export function useProductImage(
  productId: string,
): UseQueryResult<ProductImage | null, Error> {
  return useQuery({
    queryKey: queryKeys.productImages.byProduct(productId),
    queryFn: () =>
      Promise.resolve(reviewStore.image === null ? null : { ...reviewStore.image }),
    enabled: productId !== "",
  });
}

/**
 * Saves the draft specification (`PATCH /api/products/{id}` with `draftSpec`).
 *
 * The endpoint replaces the whole object while the form edits a subset of the
 * frozen fields, so the merge with the last-known draft happens here — that is
 * what keeps `cylinders`, `tankCapacityL`, `topSpeedKmh`, `abs`, `msrpEur`,
 * `extra` and `sourceHints` alive across a save. Invalidation is deliberately
 * narrow (`["products", "detail", id]`): a saved draft changes nothing in the
 * backlog list.
 */
export function useSaveDraftSpec(
  id: string,
): UseMutationResult<DraftSpec, Error, { values: Partial<DraftSpec> }> {
  const queryClient = useQueryClient();

  return useMutation<DraftSpec, Error, { values: Partial<DraftSpec> }>({
    mutationFn: async ({ values }) => {
      await sleep(STUB_LATENCY_MS);

      const merged: DraftSpec = {
        ...emptyDraftSpec(),
        ...reviewStore.product.draftSpec,
        ...values,
      };

      reviewStore.product = { ...reviewStore.product, draftSpec: merged };

      return merged;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.detail(id) });
    },
  });
}

/**
 * All-null specification, the starting point when extraction produced nothing —
 * the form then simply saves what the admin filled in.
 */
function emptyDraftSpec(): DraftSpec {
  return {
    category: null,
    engineCc: null,
    cylinders: null,
    powerKw: null,
    torqueNm: null,
    wetWeightKg: null,
    seatHeightMm: null,
    tankCapacityL: null,
    topSpeedKmh: null,
    abs: null,
    a2Eligible: null,
    priceBand: null,
    msrpEur: null,
    extra: {},
    sourceHints: null,
    extractedAt: null,
  };
}

/**
 * Rejects an image (`PATCH /api/product-images/{id}` status `rejected`) — the
 * only image transition this phase's UI performs. A rejected image is kept and
 * stays visible; the model can still be approved without one.
 */
export function useRejectImage(): UseMutationResult<
  ProductImage,
  Error,
  { imageId: string; productId: string }
> {
  const queryClient = useQueryClient();

  return useMutation<ProductImage, Error, { imageId: string; productId: string }>({
    mutationFn: async ({ imageId }) => {
      await sleep(STUB_LATENCY_MS);

      if (reviewStore.image === null || reviewStore.image.id !== imageId) {
        throw new Error(`Unknown image ${imageId}`);
      }

      reviewStore.image = { ...reviewStore.image, status: "rejected" };

      return reviewStore.image;
    },
    onSuccess: (_image, { productId }) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.productImages.byProduct(productId),
      });
    },
  });
}
