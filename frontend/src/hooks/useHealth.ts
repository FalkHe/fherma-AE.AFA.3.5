import { useQuery } from "@tanstack/react-query";

import { apiClient } from "../api/client";
import type { components } from "../api/schema";

type HealthResponse = components["schemas"]["HealthResponse"];

/** Poll interval of the liveness widget, in milliseconds. */
const REFETCH_INTERVAL_MS = 15_000;

async function fetchHealth(signal: AbortSignal): Promise<HealthResponse> {
  const { data, response } = await apiClient.GET("/health", { signal });

  // `/health` declares no error responses, so anything but a 2xx with a body
  // is an unhealthy backend rather than a payload to interpret.
  if (!response.ok || !data) {
    throw new Error(`GET /health responded ${String(response.status)}`);
  }

  return data;
}

/**
 * Liveness of the backend.
 *
 * Retry and poll settings are deliberately tighter than the TanStack defaults
 * (3 retries with exponential backoff, no polling): a status widget has to
 * report a dead backend within a second or two rather than after ~7s of silent
 * retrying, and it has to notice recovery without a page reload.
 */
export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => fetchHealth(signal),
    retry: 1,
    retryDelay: 500,
    refetchInterval: REFETCH_INTERVAL_MS,
    staleTime: REFETCH_INTERVAL_MS,
  });
}
