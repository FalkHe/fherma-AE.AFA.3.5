import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { queryKeys } from "../queryKeys";

/**
 * A manufacturer's distinct `buildingline` values — the identity panel's drift
 * guard (display-spec §6.2): it is what stops "GS", "gs" and "G S" from all
 * existing as separate families.
 *
 * `GET /api/manufacturers/{id}/buildinglines` is a *proposed* endpoint
 * (ui-spec §8 API-5) that does not exist until backend step 6.20 lands, so this
 * is a plain typed `fetch` against `VITE_API_URL`, the same origin precedent as
 * `useServerEvents` and `api/client.ts` — swapped for the generated client in
 * 6.27 once `make generate-api` knows about it.
 */

const apiBase: string = import.meta.env.VITE_API_URL ?? "";

async function listBuildinglines(manufacturerId: string): Promise<string[]> {
  const response = await fetch(
    `${apiBase}/api/manufacturers/${encodeURIComponent(manufacturerId)}/buildinglines`,
    // Session auth is a cookie (see api/client.ts); GET is a safe method, so no
    // CSRF header is needed.
    { credentials: "include" },
  );

  if (!response.ok) {
    throw new Error(`Buildingline options request failed with status ${response.status}`);
  }

  return (await response.json()) as string[];
}

/**
 * A manufacturer's buildingline options, refetched whenever the selected
 * manufacturer changes. Disabled while no manufacturer is selected — the
 * identity panel renders the field itself `disabled` in that state (ui-spec
 * §1.2), it does not render an empty, freely-typable `Autocomplete`.
 */
export function useBuildinglines(
  manufacturerId: string | null,
): UseQueryResult<string[], Error> {
  return useQuery({
    queryKey: queryKeys.buildinglines.byManufacturer(manufacturerId ?? ""),
    queryFn: () => listBuildinglines(manufacturerId ?? ""),
    enabled: manufacturerId !== null,
    // Near-static, like useManufacturers.
    staleTime: 5 * 60_000,
  });
}
