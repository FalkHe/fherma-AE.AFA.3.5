import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { queryKeys } from "../queryKeys";

/**
 * STUB — the whole file is replaced wholesale in step 2.15, when
 * `GET /api/operations` reaches the generated API client. The exported names
 * and the query key are pinned by `docs/roadmap/phase-2/shared-knowledge.md`.
 *
 * Real here: the query, its key and the `select` that reduces the list to the
 * newest operation per entity — the part every consumer depends on. Only
 * `listOperations` goes away in 2.15.
 */

/** Background-job state, as the read-only `operations` resource delivers it. */
export interface Operation {
  id: string;
  type: string;
  status: "queued" | "running" | "succeeded" | "failed";
  /** Percent, `NOT NULL DEFAULT 0` server-side — never null. */
  progress: number;
  /**
   * Current step, server-generated English. Rendered verbatim in the admin UI
   * (the one deliberate exemption from i18n, like document prose).
   */
  message: string | null;
  error: string | null;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

// --- Stub server (deleted in 2.15) -----------------------------------------

/**
 * The two product ids referenced below are repeated from `useProducts.ts` on
 * purpose: both stubs die in step 2.15 and neither should hold the other
 * hostage until then.
 */
const INGESTING_PRODUCT_ID = "01STUBPRODUCTINGESTING0001";
const BACKLOG_PRODUCT_ID = "01STUBPRODUCTBACKLOG000001";

/**
 * A running ingestion for the `ingesting` model and a failed one for the
 * `backlog` model — the pinned fixture pair, which between them cover the
 * determinate progress bar and the failed line with its retry affordance.
 */
const FIXTURE_OPERATIONS: readonly Operation[] = [
  {
    id: "01STUBOPERATIONRUNNING0001",
    type: "ingestion",
    status: "running",
    progress: 40,
    message: "Fetching sources (2/6)",
    error: null,
    entityType: "motorbike",
    entityId: INGESTING_PRODUCT_ID,
    createdAt: "2026-08-25T09:03:00Z",
    startedAt: "2026-08-25T09:03:04Z",
    finishedAt: null,
  },
  {
    id: "01STUBOPERATIONFAILED00001",
    type: "ingestion",
    status: "failed",
    progress: 15,
    message: "No usable sources could be retrieved",
    error: "No usable sources could be retrieved",
    entityType: "motorbike",
    entityId: BACKLOG_PRODUCT_ID,
    createdAt: "2026-08-24T08:12:00Z",
    startedAt: "2026-08-24T08:12:03Z",
    finishedAt: "2026-08-24T08:41:00Z",
  },
];

function listOperations(): Promise<Operation[]> {
  return Promise.resolve([...FIXTURE_OPERATIONS]);
}

// --- Hook (contract; survives 2.15) ----------------------------------------

/**
 * The newest operation per referenced entity, so a row or a page can look up
 * "what is happening to this model" by id.
 *
 * Reducing the full list client-side is deliberate: the operations table is
 * small, one cached query then serves every row of the backlog, and a progress
 * tick therefore refetches once rather than once per visible model.
 */
function latestByEntity(operations: Operation[]): Map<string, Operation> {
  const latest = new Map<string, Operation>();

  for (const operation of operations) {
    if (operation.entityId === null) {
      continue;
    }

    const known = latest.get(operation.entityId);

    if (known === undefined || known.createdAt < operation.createdAt) {
      latest.set(operation.entityId, operation);
    }
  }

  return latest;
}

export function useLatestOperationsByEntity(): UseQueryResult<
  Map<string, Operation>,
  Error
> {
  return useQuery({
    queryKey: queryKeys.operations.list(),
    queryFn: listOperations,
    // Module-level function: a `select` defined inline would be a new
    // reference on every render and rebuild the Map each time.
    select: latestByEntity,
  });
}
