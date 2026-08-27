/**
 * The application's query keys, in one place.
 *
 * Every cached server resource is keyed here rather than at its call site,
 * because two unrelated parties have to agree on the exact same arrays: the
 * hooks that read (`useQuery`) and the SSE listener that invalidates
 * (`useServerEvents`). A key typed out twice is a cache that silently stops
 * refreshing, which is the one bug this UI cannot afford — live ingestion
 * progress is the phase's demo.
 *
 * Invalidation always targets a **prefix** (`all`), never a fully-built key:
 * blanket-invalidating a handful of queries is free at this scale and immune to
 * drift in the argument part of a key.
 */

/**
 * Status filter of the backlog list. Kept as a plain string rather than the
 * `ProductStatus` union so this module depends on nothing — the products hooks
 * pass their own narrower type and the key shape stays identical.
 */
type StatusFilter = string | undefined;

export const queryKeys = {
  products: {
    /** Invalidation prefix: every product list and detail query. */
    all: ["products"] as const,
    /** `GET /api/products` (+ `filter[status]` when set). */
    list: (status?: StatusFilter) => ["products", "list", { status }] as const,
    /** `GET /api/products/{id}`. */
    detail: (id: string) => ["products", "detail", id] as const,
  },
  operations: {
    /** Invalidation prefix: the operations list. */
    all: ["operations"] as const,
    /** `GET /api/operations`. */
    list: () => ["operations", "list"] as const,
  },
  documents: {
    /** Invalidation prefix: every product's documents. */
    all: ["documents"] as const,
    /** `GET /api/documents?filter[product]=…`. */
    byProduct: (productId: string) => ["documents", productId] as const,
  },
  productImages: {
    /** Invalidation prefix: every product's images. */
    all: ["productImages"] as const,
    /** `GET /api/product-images?filter[product]=…`. */
    byProduct: (productId: string) => ["productImages", productId] as const,
  },
  chats: {
    /** Invalidation prefix: the consultation list and every chat detail. */
    all: ["chats"] as const,
    /** `GET /api/chats` — the signed-in user's consultations, last activity first. */
    list: () => ["chats", "list"] as const,
    /** `GET /api/chats/{id}` — carries `activeOperationId`, i.e. the turn state. */
    detail: (id: string) => ["chats", "detail", id] as const,
  },
  chatMessages: {
    /** Invalidation prefix: every chat's timeline. */
    all: ["chatMessages"] as const,
    /** `GET /api/chat-messages?filter[chat]=…`, oldest → newest. */
    byChat: (chatId: string) => ["chatMessages", chatId] as const,
  },
} as const;
