import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { apiClient } from "../api/client";
import type { components } from "../api/schema";
import { queryKeys } from "../queryKeys";

import { ProductError, type Product } from "./useProducts";

/**
 * Everything the review screen reads and writes for one model: the product
 * itself, its retrieved documents, its fetched image, the draft specification
 * and the one image moderation action this phase offers.
 *
 * As in `useProducts`, the JSON:API envelope is unwrapped **here and nowhere
 * else** — components receive flat rows (`id` merged with the attributes) and
 * never reach into `.attributes`. Nothing updates optimistically: every mutation
 * awaits the server and then invalidates, so the screen renders refetched server
 * truth.
 *
 * Neither `/api/documents` nor `/api/product-images` is paginated (a model has a
 * handful of documents and at most one image per ingestion run, and the review
 * screen needs the complete document list for its picker), so unlike the backlog
 * list hooks these two send no `page[…]` parameters and read `meta.totalCount`
 * as "the number of rows delivered".
 */

/** A specification revision as the API returns it (`draftSpec`/`verifiedSpec`). */
export type DraftSpec = components["schemas"]["SpecAttributes"];

/** Provenance class of a source document (`source_type` in the catalogue). */
export type SourceType = components["schemas"]["SourceType"];

/** One retrieved source document, flattened out of its JSON:API envelope. */
export type SourceDocument = {
  id: string;
} & components["schemas"]["DocumentAttributes"];

/** Moderation state of a fetched image. */
export type ImageStatus = components["schemas"]["ImageStatus"];

/**
 * The one image an ingestion run fetched, with the variant URLs the API computes
 * (`/media/motorbikes/{motorbikeId}/{imageId}_{variant}.webp`).
 */
export type ProductImage = {
  id: string;
} & components["schemas"]["ProductImageAttributes"];

/**
 * A failed draft-spec save.
 *
 * Same shape and rationale as Phase-1's `AuthError`: the backend's `detail` is
 * English prose for developers, so the screen decides its own message from the
 * status code, and `validationFields` carries the field names out of a
 * request-validation 422 (the last segment of each `loc`) so a rejected value
 * can be shown on the field it belongs to instead of as a general error.
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

/** The error bodies these endpoints answer with (see shared-knowledge). */
type ErrorBody =
  | components["schemas"]["ErrorDocument"]
  | components["schemas"]["HTTPValidationError"]
  | undefined;

/**
 * The stable application code of a domain failure (`not-found`,
 * `invalid-transition`, `missing-filter`, …), `null` for the shapes that carry
 * none — FastAPI's request-validation 422 and the auth/CSRF `{"detail": …}`
 * bodies. Never branch on `detail` text.
 */
function errorCode(body: ErrorBody): string | null {
  return body !== undefined && "errors" in body && body.errors.length > 0
    ? body.errors[0].code
    : null;
}

/**
 * The field names of a request-validation 422, e.g. `["body", "data",
 * "attributes", "draftSpec", "powerKw"]` → `"powerKw"`. A JSON:API error
 * document has no `loc`, so a domain failure maps to no field and the form shows
 * its general error instead.
 */
function validationFields(body: ErrorBody): string[] {
  if (body === undefined || !("detail" in body) || body.detail === undefined) {
    return [];
  }

  return body.detail
    .map((entry) => entry.loc.at(-1))
    .filter((segment): segment is string => typeof segment === "string");
}

/** `GET /api/products/{id}` — the shell of the review screen. */
async function getProduct(id: string): Promise<Product> {
  const { data, error, response } = await apiClient.GET("/api/products/{product_id}", {
    params: { path: { product_id: id } },
  });

  if (!response.ok || data === undefined) {
    // A vanished or mistyped id answers 404 `not-found`; the route tells that
    // apart from a network/5xx failure by the status.
    throw new ProductError(response.status, errorCode(error));
  }

  return { id: data.data.id, ...data.data.attributes };
}

/** `GET /api/documents?filter[product]=…` — Wikipedia first, then oldest first. */
async function listDocuments(productId: string): Promise<SourceDocument[]> {
  const { data, error, response } = await apiClient.GET("/api/documents", {
    params: { query: { "filter[product]": productId } },
  });

  if (!response.ok || data === undefined) {
    throw new ProductError(response.status, errorCode(error));
  }

  // Order is the server's (Wikipedia first) and stays untouched: the panel's
  // "no selection = the first document" rule depends on it.
  return data.data.map((resource) => ({ id: resource.id, ...resource.attributes }));
}

/**
 * The newest of a product's images.
 *
 * The endpoint already sorts newest first, but the newest row is *the* contract
 * of this hook (ingestion keeps at most one image per run, and a re-run leaves
 * the previous one behind), so it is picked by `createdAt` rather than by
 * position. Equal timestamps keep the earlier row, which is the server's own
 * tiebreak.
 */
function newestImage(rows: ProductImage[]): ProductImage | null {
  return rows.reduce<ProductImage | null>(
    (newest, row) =>
      newest === null || row.createdAt > newest.createdAt ? row : newest,
    null,
  );
}

/** `GET /api/product-images?filter[product]=…`, reduced to the newest row. */
async function getNewestImage(productId: string): Promise<ProductImage | null> {
  const { data, error, response } = await apiClient.GET("/api/product-images", {
    params: { query: { "filter[product]": productId } },
  });

  if (!response.ok || data === undefined) {
    throw new ProductError(response.status, errorCode(error));
  }

  return newestImage(
    data.data.map((resource) => ({ id: resource.id, ...resource.attributes })),
  );
}

/**
 * All-null specification: the base of every merge, and what a model whose
 * extraction produced nothing starts from.
 *
 * Spelled out rather than derived, because the `PATCH` is a full-object replace
 * — a field missing from the merge is a field reset to NULL server-side.
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

/** `PATCH /api/products/{id}` carrying a complete draft specification. */
async function patchDraftSpec(id: string, draftSpec: DraftSpec): Promise<DraftSpec> {
  const { data, error, response } = await apiClient.PATCH("/api/products/{product_id}", {
    params: { path: { product_id: id } },
    body: { data: { type: "products", attributes: { draftSpec } } },
  });

  if (!response.ok || data === undefined) {
    throw new SaveDraftSpecError(response.status, validationFields(error));
  }

  // The upsert answers with the stored draft; the merged object is the fallback
  // for the (impossible by contract) case of a response without one.
  return data.data.attributes.draftSpec ?? draftSpec;
}

/** `PATCH /api/product-images/{id}` — the one image transition this UI performs. */
async function patchImageStatus(
  imageId: string,
  status: ImageStatus,
): Promise<ProductImage> {
  const { data, error, response } = await apiClient.PATCH(
    "/api/product-images/{image_id}",
    {
      params: { path: { image_id: imageId } },
      body: { data: { type: "product-images", attributes: { status } } },
    },
  );

  if (!response.ok || data === undefined) {
    // An illegal move answers 422 `invalid-transition`, a vanished row 404.
    throw new ProductError(response.status, errorCode(error));
  }

  return { id: data.data.id, ...data.data.attributes };
}

/** The reviewed model itself. */
export function useProduct(id: string): UseQueryResult<Product, Error> {
  return useQuery({
    queryKey: queryKeys.products.detail(id),
    queryFn: () => getProduct(id),
    // The route param can be empty for a fraction of a render; asking the API
    // for product "" would answer 404 and show the wrong gate.
    enabled: id !== "",
  });
}

/** Every source document the ingestion retained for the model. */
export function useProductDocuments(
  productId: string,
): UseQueryResult<SourceDocument[], Error> {
  return useQuery({
    queryKey: queryKeys.documents.byProduct(productId),
    queryFn: () => listDocuments(productId),
    enabled: productId !== "",
  });
}

/**
 * The model's image, or `null`.
 *
 * `null` is a normal answer, not an error: ingestion may find no usable image at
 * all, and a model can be published without one.
 */
export function useProductImage(
  productId: string,
): UseQueryResult<ProductImage | null, Error> {
  return useQuery({
    queryKey: queryKeys.productImages.byProduct(productId),
    queryFn: () => getNewestImage(productId),
    enabled: productId !== "",
  });
}

/**
 * Saves the draft specification (`PATCH /api/products/{id}` with `draftSpec`).
 *
 * The endpoint replaces the whole object while the form edits a subset of the
 * frozen fields, so the merge with the **last-fetched** draft happens here: the
 * cached product detail supplies the current values, the form values override
 * them, and the all-null base fills what neither knows. That is what keeps
 * `cylinders`, `tankCapacityL`, `topSpeedKmh`, `abs`, `msrpEur`, `extra`,
 * `sourceHints` and `extractedAt` alive across a save.
 *
 * Invalidation is deliberately narrow (`["products", "detail", id]`): a saved
 * draft changes nothing in the backlog list or in any operation.
 */
export function useSaveDraftSpec(
  id: string,
): UseMutationResult<DraftSpec, Error, { values: Partial<DraftSpec> }> {
  const queryClient = useQueryClient();

  return useMutation<DraftSpec, Error, { values: Partial<DraftSpec> }>({
    mutationFn: ({ values }) => {
      const cached = queryClient.getQueryData<Product>(queryKeys.products.detail(id));

      return patchDraftSpec(id, {
        ...emptyDraftSpec(),
        ...cached?.draftSpec,
        ...values,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.detail(id) });
    },
  });
}

/**
 * Rejects an image (`PATCH /api/product-images/{id}` status `rejected`).
 *
 * A rejected image is kept and stays visible — the admin can still see what was
 * turned down, and the model can be approved without one. The write also
 * announces `product.updated` server-side, hence the blanket product/operation
 * invalidation next to the image one.
 */
export function useRejectImage(): UseMutationResult<
  ProductImage,
  Error,
  { imageId: string; productId: string }
> {
  const queryClient = useQueryClient();

  return useMutation<ProductImage, Error, { imageId: string; productId: string }>({
    mutationFn: ({ imageId }) => patchImageStatus(imageId, "rejected"),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.operations.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.productImages.all });
    },
  });
}
