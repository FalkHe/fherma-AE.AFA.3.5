import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { queryKeys } from "../queryKeys";

/**
 * STUB — the whole file is replaced wholesale in step 2.15, when the products
 * endpoints reach the generated API client. The exported names, the argument
 * shapes and the query keys are pinned by
 * `docs/roadmap/phase-2/shared-knowledge.md`; do not change them, and do not
 * import anything from here that 2.15 will not still export.
 *
 * What is real here: the TanStack Query plumbing. The hooks return genuine
 * `useQuery`/`useMutation` results over an in-memory fixture table, keyed and
 * invalidated exactly as the live versions will be, so the components written
 * against them survive the replacement without edits. Only the functions that
 * talk to the "server" (below) go away in 2.15.
 */

/** Motorbike lifecycle, per the pinned `motorbike_status` enum. */
export type ProductStatus =
  | "backlog"
  | "ingesting"
  | "in_review"
  | "approved"
  | "rejected";

/** A row of the catalogue, as the `products` resource will deliver it. */
export interface Product {
  id: string;
  name: string;
  slug: string;
  manufacturer: string | null;
  modelName: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
}

/** Server-side filtering of the list query (`filter[status]`). */
export interface ProductFilters {
  status?: ProductStatus;
}

/**
 * A failed products call, carrying the status code the screens branch on.
 *
 * Same shape and rationale as Phase-1's `AuthError`: the backend's JSON:API
 * error `detail` is English prose for developers, so the UI decides its own
 * message from the status code alone (409 duplicate, 422 validation, anything
 * else "server error"). 2.15 must keep this export.
 */
export class ProductError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Products request failed with status ${status}`);
    this.name = "ProductError";
    this.status = status;
  }
}

// --- Stub server (deleted in 2.15) -----------------------------------------

/**
 * Fixture ids, 26 characters like the ULID primary keys they stand in for.
 * `useOperations.ts` repeats the two it references — the stubs stay independent
 * of each other so either can be deleted on its own.
 */
const FIXTURE_IDS = {
  backlog: "01STUBPRODUCTBACKLOG000001",
  ingesting: "01STUBPRODUCTINGESTING0001",
  inReview: "01STUBPRODUCTINREVIEW00001",
  approved: "01STUBPRODUCTAPPROVED00001",
  rejected: "01STUBPRODUCTREJECTED00001",
} as const;

/**
 * One model per status, so every chip colour, every progress state and both
 * row actions are reachable in the browser before any API exists. The backlog
 * entry deliberately has no manufacturer or model name: that is what a
 * just-added row looks like until extraction fills them in.
 */
const FIXTURE_PRODUCTS: readonly Product[] = [
  {
    id: FIXTURE_IDS.backlog,
    name: "Honda CB500F",
    slug: "honda-cb500f",
    manufacturer: null,
    modelName: null,
    yearFrom: null,
    yearTo: null,
    status: "backlog",
    createdAt: "2026-08-24T08:12:00Z",
    updatedAt: "2026-08-24T08:41:00Z",
  },
  {
    id: FIXTURE_IDS.ingesting,
    name: "Suzuki GSR 600",
    slug: "suzuki-gsr-600",
    manufacturer: "Suzuki",
    modelName: "GSR 600",
    yearFrom: 2006,
    yearTo: 2011,
    status: "ingesting",
    createdAt: "2026-08-25T09:03:00Z",
    updatedAt: "2026-08-25T09:14:00Z",
  },
  {
    id: FIXTURE_IDS.inReview,
    name: "Yamaha MT-07",
    slug: "yamaha-mt-07",
    manufacturer: "Yamaha",
    modelName: "MT-07",
    yearFrom: 2014,
    yearTo: null,
    status: "in_review",
    createdAt: "2026-08-23T16:30:00Z",
    updatedAt: "2026-08-24T11:05:00Z",
  },
  {
    id: FIXTURE_IDS.approved,
    name: "Kawasaki Z650",
    slug: "kawasaki-z650",
    manufacturer: "Kawasaki",
    modelName: "Z650",
    yearFrom: 2017,
    yearTo: null,
    status: "approved",
    createdAt: "2026-08-20T10:00:00Z",
    updatedAt: "2026-08-22T13:47:00Z",
  },
  {
    id: FIXTURE_IDS.rejected,
    name: "BMW G 310 R",
    slug: "bmw-g-310-r",
    manufacturer: "BMW",
    modelName: "G 310 R",
    yearFrom: 2016,
    yearTo: null,
    status: "rejected",
    createdAt: "2026-08-18T07:22:00Z",
    updatedAt: "2026-08-19T09:15:00Z",
  },
];

/**
 * The stub's mutable table. Creating and transitioning write to it so the list
 * query refetches into visibly different data — without that, "add a model"
 * and "retry ingestion" would look broken to anyone clicking through the screen
 * before 2.15.
 */
let stubProducts: Product[] = [...FIXTURE_PRODUCTS];

/** Round trip long enough to make the pending states observable in the UI. */
const STUB_LATENCY_MS = 400;

function stubLatency(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, STUB_LATENCY_MS);
  });
}

/** The service-side slug rule from shared-knowledge, for duplicate detection. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function listProducts(filters: ProductFilters): Promise<Product[]> {
  const { status } = filters;
  const rows =
    status === undefined
      ? stubProducts
      : stubProducts.filter((product) => product.status === status);

  // Default sort of every list endpoint is `-createdAt`.
  return Promise.resolve(
    [...rows].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
  );
}

async function createProduct({ name }: { name: string }): Promise<Product> {
  await stubLatency();

  const slug = slugify(name);

  if (stubProducts.some((product) => product.slug === slug)) {
    // Mirrors the pinned 409 `duplicate-model` answer, so the dialog's
    // duplicate branch is reachable before the API exists.
    throw new ProductError(409);
  }

  const now = new Date().toISOString();
  const created: Product = {
    id: `01STUBCREATED${Date.now()}`.padEnd(26, "0").slice(0, 26),
    name: name.trim(),
    slug,
    manufacturer: null,
    modelName: null,
    yearFrom: null,
    yearTo: null,
    status: "backlog",
    createdAt: now,
    updatedAt: now,
  };

  stubProducts = [created, ...stubProducts];

  return created;
}

async function transitionProduct({
  id,
  status,
}: {
  id: string;
  status: ProductStatus;
}): Promise<Product> {
  await stubLatency();

  const current = stubProducts.find((product) => product.id === id);

  if (current === undefined) {
    throw new ProductError(404);
  }

  const updated: Product = { ...current, status, updatedAt: new Date().toISOString() };

  stubProducts = stubProducts.map((product) => (product.id === id ? updated : product));

  return updated;
}

// --- Hooks (contract; survives 2.15) ---------------------------------------

/**
 * The backlog list, optionally narrowed to one status.
 *
 * The filter is part of the key rather than a client-side `select`, because the
 * live version filters server-side and each filter therefore has its own cache
 * entry.
 */
export function useProducts(
  statusFilter?: ProductStatus,
): UseQueryResult<Product[], Error> {
  return useQuery({
    queryKey: queryKeys.products.list(statusFilter),
    queryFn: () => listProducts({ status: statusFilter }),
  });
}

/**
 * Adds a model to the backlog (`POST /api/products`; ingestion auto-starts
 * server-side from step 2.14).
 *
 * Invalidation lives here, not at the call site: both caches are affected by
 * every write regardless of which screen triggered it. No optimistic update —
 * the admin UI always renders refetched server truth.
 */
export function useCreateProduct(): UseMutationResult<Product, Error, { name: string }> {
  const queryClient = useQueryClient();

  return useMutation<Product, Error, { name: string }>({
    mutationFn: createProduct,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.operations.all });
    },
  });
}

/**
 * Moves a model to another status (`PATCH /api/products/{id}`). The transition
 * matrix is enforced server-side; a rejected transition answers 422.
 */
export function useTransitionProduct(): UseMutationResult<
  Product,
  Error,
  { id: string; status: ProductStatus }
> {
  const queryClient = useQueryClient();

  return useMutation<Product, Error, { id: string; status: ProductStatus }>({
    mutationFn: transitionProduct,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.operations.all });
    },
  });
}
