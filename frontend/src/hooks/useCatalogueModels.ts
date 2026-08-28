import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";

import { queryKeys } from "../queryKeys";

import type { CatalogueFilters, PriceBand, SpecCategory } from "./useCatalogueFilters";

/**
 * STUB — the whole file is replaced wholesale in step 4.9, when the
 * `catalogue-models` and `manufacturers` endpoints reach the generated API
 * client. The exported names, the argument shapes, the returned row shape and
 * the query keys are pinned by `docs/roadmap/phase-4/shared-knowledge.md`
 * (§Frontend conventions — delta) and this file's landed decisions; do not
 * change them, and do not import anything from here that 4.9 will not still
 * export (`PAGE_SIZE`, `CatalogueListItem`, `CatalogueModelPage`,
 * `Manufacturer`, `useCatalogueModels`, `useManufacturers`).
 *
 * What is real here: the TanStack Query plumbing. Both hooks return genuine
 * `useQuery` results — same keys, same `keepPreviousData` behaviour, same
 * `staleTime` — over an in-memory fixture catalogue that is filtered, sorted
 * and paged **from the parsed URL params**, exactly as the server will do it.
 * That is what proves the shareable-URL contract before any backend exists.
 * Only the "stub server" section goes away in 4.9.
 *
 * The image URLs point at real files in the development media directory, so the
 * grid renders actual photographs while the endpoint is still missing; they are
 * fixture data like everything else in this section.
 */

// --- Contract types (survive 4.9) ------------------------------------------

/**
 * Pinned page size, mirrored by the backend request (`page[size]=24`). It lives
 * with the hook that sends it, and the list route imports it to derive the page
 * count from `totalCount`.
 */
export const PAGE_SIZE = 24;

/**
 * One card of the grid (ui-spec §3.5 data needs).
 *
 * The wire delivers `imageUrl` (the *card* variant) and the client derives the
 * thumbnail by swapping the pinned `_card.webp` suffix; that derivation happens
 * here so `CatalogueModelCard` never does URL arithmetic. Attributes the card
 * does not render (`msrpEur`, `a2Eligible`) are deliberately absent — the
 * server filters and sorts on them.
 */
export interface CatalogueListItem {
  motorbikeId: string;
  name: string;
  manufacturer: string | null;
  category: SpecCategory | null;
  priceBand: PriceBand | null;
  engineCc: number | null;
  powerKw: number | null;
  wetWeightKg: number | null;
  seatHeightMm: number | null;
  /** Both variant URLs, ready for `srcSet`, or `null` for a model without one. */
  image: { card: string; thumb: string } | null;
}

/** One page of the catalogue plus the total the pagination and count need. */
export interface CatalogueModelPage {
  items: CatalogueListItem[];
  totalCount: number;
}

/** A manufacturer option of the filter select. */
export interface Manufacturer {
  id: string;
  name: string;
}

// --- Stub server (deleted in 4.9) ------------------------------------------

/** Fixture ids, 26 characters like the ULID primary keys they stand in for. */
function stubId(label: string): string {
  return `01STUB${label.toUpperCase()}`.padEnd(26, "0").slice(0, 26);
}

const MANUFACTURERS: readonly Manufacturer[] = [
  { id: stubId("mfrbmw"), name: "BMW" },
  { id: stubId("mfrhonda"), name: "Honda" },
  { id: stubId("mfrsuzuki"), name: "Suzuki" },
  { id: stubId("mfryamaha"), name: "Yamaha" },
];

const MANUFACTURER_BY_NAME = new Map(
  MANUFACTURERS.map((manufacturer) => [manufacturer.name, manufacturer]),
);

/**
 * Real approved images from the development media directory — the same
 * `/media/motorbikes/{motorbikeId}/{imageId}_card.webp` shape the endpoint will
 * return, so the `_card` → `_thumb` swap below is exercised for real.
 */
const IMAGE_PATHS: readonly string[] = [
  "/media/motorbikes/01M10X5YWZ0T0TAKAV58MNKWFJ/01M10X642K3JCH395BA9VXET28_card.webp",
  "/media/motorbikes/01M10YCXRBW5ANBJT5MK638EK5/01M10YD8Q3CJ4BT4F00TAMNMP3_card.webp",
  "/media/motorbikes/01M10WSCDCVD8P5AG7AWVEXWJK/01M10WSKNMZ3ZP9FEX7JPMQ7AW_card.webp",
  "/media/motorbikes/01M112N358BYCK15Y6E3ZGS75V/01M112P80J0ZKG35ZDMVASJZVB_card.webp",
];

/**
 * Server-relative `/media/…` URLs resolve against Vite in development, where the
 * API lives on another origin — same prefix convention as `api/client.ts`.
 */
const mediaBase: string = import.meta.env.VITE_API_URL ?? "";

/** The pinned suffix swap: the payload carries the card variant only. */
function imageVariants(imageUrl: string | null): CatalogueListItem["image"] {
  if (imageUrl === null) {
    return null;
  }

  return {
    card: mediaBase + imageUrl,
    thumb: mediaBase + imageUrl.replace(/_card\.webp$/, "_thumb.webp"),
  };
}

/** A fixture row: a list item plus the columns the server filters and sorts on. */
type FixtureModel = CatalogueListItem & {
  manufacturerId: string | null;
  msrpEur: number | null;
  a2Eligible: boolean | null;
};

function fixture(
  key: string,
  name: string,
  manufacturerName: string | null,
  category: SpecCategory | null,
  priceBand: PriceBand | null,
  specs: {
    engineCc?: number;
    powerKw?: number;
    wetWeightKg?: number;
    seatHeightMm?: number;
    msrpEur?: number;
    a2Eligible?: boolean;
  },
  imageIndex: number | null,
): FixtureModel {
  const manufacturer =
    manufacturerName === null ? undefined : MANUFACTURER_BY_NAME.get(manufacturerName);

  return {
    motorbikeId: stubId(key),
    name,
    manufacturer: manufacturer?.name ?? null,
    manufacturerId: manufacturer?.id ?? null,
    category,
    priceBand,
    engineCc: specs.engineCc ?? null,
    powerKw: specs.powerKw ?? null,
    wetWeightKg: specs.wetWeightKg ?? null,
    seatHeightMm: specs.seatHeightMm ?? null,
    msrpEur: specs.msrpEur ?? null,
    a2Eligible: specs.a2Eligible ?? null,
    image: imageVariants(imageIndex === null ? null : IMAGE_PATHS[imageIndex]),
  };
}

/**
 * 29 models — more than `PAGE_SIZE + 3`, so pagination is real — spread across
 * four manufacturers, nine categories and all four price bands, so every filter
 * visibly narrows the grid. Deliberate outliers: several models without an
 * image (fallback box), one without a manufacturer (no separator line) and one
 * with no specs at all (name and manufacturer only).
 */
const FIXTURE_MODELS: readonly FixtureModel[] = [
  fixture("bmwf850gs", "BMW F 850 GS", "BMW", "adventure", "upper", { engineCc: 853, powerKw: 70, wetWeightKg: 229, seatHeightMm: 860, msrpEur: 13200, a2Eligible: false }, 0),
  fixture("bmwf900r", "BMW F 900 R", "BMW", "naked", "upper", { engineCc: 895, powerKw: 77, wetWeightKg: 211, seatHeightMm: 815, msrpEur: 11400, a2Eligible: false }, 2),
  fixture("bmwg310r", "BMW G 310 R", "BMW", "naked", "budget", { engineCc: 313, powerKw: 25, wetWeightKg: 158, seatHeightMm: 785, msrpEur: 4990, a2Eligible: true }, 3),
  fixture("bmwr1250gs", "BMW R 1250 GS", "BMW", "adventure", "premium", { engineCc: 1254, powerKw: 100, wetWeightKg: 249, seatHeightMm: 850, msrpEur: 19900, a2Eligible: false }, 1),
  fixture("bmwninet", "BMW R nineT", "BMW", "classic", "premium", { engineCc: 1170, powerKw: 80, wetWeightKg: 221, seatHeightMm: 805, msrpEur: 16400, a2Eligible: false }, null),
  fixture("bmws1000xr", "BMW S 1000 XR", "BMW", "sport_touring", "premium", { engineCc: 999, powerKw: 121, wetWeightKg: 226, seatHeightMm: 840, msrpEur: 18500, a2Eligible: false }, 0),
  fixture("hondaafricatwin", "Honda CRF1100L Africa Twin", "Honda", "adventure", "upper", { engineCc: 1084, powerKw: 75, wetWeightKg: 226, seatHeightMm: 850, msrpEur: 14800, a2Eligible: false }, 0),
  fixture("hondacb125r", "Honda CB125R", "Honda", "naked", "budget", { engineCc: 125, powerKw: 11, wetWeightKg: 130, seatHeightMm: 816, msrpEur: 4700, a2Eligible: true }, 0),
  fixture("hondacb500f", "Honda CB500F", "Honda", "naked", "mid", { engineCc: 471, powerKw: 35, wetWeightKg: 189, seatHeightMm: 785, msrpEur: 6800, a2Eligible: true }, 1),
  fixture("hondacb650r", "Honda CB650R", "Honda", "naked", "mid", { engineCc: 649, powerKw: 70, wetWeightKg: 202, seatHeightMm: 810, msrpEur: 8900, a2Eligible: false }, 2),
  fixture("hondacbr600rr", "Honda CBR600RR", "Honda", "sport", "upper", { engineCc: 599, powerKw: 89, wetWeightKg: 194, seatHeightMm: 820, msrpEur: 13400, a2Eligible: false }, 3),
  fixture("hondarebel500", "Honda Rebel 500", "Honda", "cruiser", "mid", { engineCc: 471, powerKw: 34, wetWeightKg: 191, seatHeightMm: 690, msrpEur: 6500, a2Eligible: true }, null),
  fixture("hondatransalp", "Honda XL750 Transalp", "Honda", "adventure", "upper", { engineCc: 755, powerKw: 67, wetWeightKg: 208, seatHeightMm: 850, msrpEur: 10500, a2Eligible: false }, 1),
  fixture("sinnisterrain", "Sinnis Terrain 380", null, "scrambler", "budget", { engineCc: 378, powerKw: 29, wetWeightKg: 172, seatHeightMm: 835, msrpEur: 4400, a2Eligible: true }, null),
  fixture("suzukiburgman", "Suzuki Burgman 400", "Suzuki", "scooter", "mid", { engineCc: 400, powerKw: 22, wetWeightKg: 218, seatHeightMm: 755, msrpEur: 7900, a2Eligible: true }, 3),
  fixture("suzukidrz400", "Suzuki DR-Z400S", "Suzuki", "enduro", "mid", { engineCc: 398, powerKw: 29, wetWeightKg: 144, seatHeightMm: 935, msrpEur: 7200, a2Eligible: true }, null),
  fixture("suzukigsr600", "Suzuki GSR 600", "Suzuki", "naked", "budget", { engineCc: 599, powerKw: 72.5, wetWeightKg: 197, seatHeightMm: 785, msrpEur: 4200, a2Eligible: false }, 3),
  fixture("suzukigsx8s", "Suzuki GSX-8S", "Suzuki", null, null, {}, null),
  fixture("suzukigsxr750", "Suzuki GSX-R750", "Suzuki", "sport", "upper", { engineCc: 750, powerKw: 110, wetWeightKg: 190, seatHeightMm: 810, msrpEur: 12800, a2Eligible: false }, 1),
  fixture("suzukikatana", "Suzuki Katana", "Suzuki", "naked", "upper", { engineCc: 999, powerKw: 112, wetWeightKg: 215, seatHeightMm: 825, msrpEur: 13900, a2Eligible: false }, 2),
  fixture("suzukisv650", "Suzuki SV650", "Suzuki", "naked", "mid", { engineCc: 645, powerKw: 56, wetWeightKg: 198, seatHeightMm: 785, msrpEur: 7300, a2Eligible: true }, 0),
  fixture("suzukivstrom650", "Suzuki V-Strom 650", "Suzuki", "adventure", "mid", { engineCc: 645, powerKw: 52, wetWeightKg: 216, seatHeightMm: 835, msrpEur: 9200, a2Eligible: false }, null),
  fixture("yamahamt07", "Yamaha MT-07", "Yamaha", "naked", "mid", { engineCc: 689, powerKw: 54, wetWeightKg: 184, seatHeightMm: 805, msrpEur: 8200, a2Eligible: false }, 2),
  fixture("yamahamt09", "Yamaha MT-09", "Yamaha", "naked", "upper", { engineCc: 890, powerKw: 87, wetWeightKg: 193, seatHeightMm: 825, msrpEur: 10900, a2Eligible: false }, 3),
  fixture("yamahamt125", "Yamaha MT-125", "Yamaha", "naked", "budget", { engineCc: 124, powerKw: 11, wetWeightKg: 142, seatHeightMm: 810, msrpEur: 4900, a2Eligible: true }, null),
  fixture("yamahatenere700", "Yamaha Ténéré 700", "Yamaha", "adventure", "upper", { engineCc: 689, powerKw: 54, wetWeightKg: 204, seatHeightMm: 875, msrpEur: 11200, a2Eligible: false }, 1),
  fixture("yamahatracer9", "Yamaha Tracer 9", "Yamaha", "sport_touring", "upper", { engineCc: 890, powerKw: 87, wetWeightKg: 213, seatHeightMm: 810, msrpEur: 13500, a2Eligible: false }, 2),
  fixture("yamahaxsr700", "Yamaha XSR700", "Yamaha", "classic", "mid", { engineCc: 689, powerKw: 54, wetWeightKg: 188, seatHeightMm: 835, msrpEur: 9100, a2Eligible: false }, null),
  fixture("yamahayzfr7", "Yamaha YZF-R7", "Yamaha", "sport", "upper", { engineCc: 689, powerKw: 54, wetWeightKg: 188, seatHeightMm: 835, msrpEur: 10200, a2Eligible: false }, 0),
];

/** Round trip long enough to make the skeletons and the progress bar visible. */
const STUB_LATENCY_MS = 250;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * The pinned NULL-spec browse rule: a NULL value never matches a stated filter
 * on that column, so a model with no verified spec drops out of every filtered
 * result and stays in the unfiltered one.
 */
function withinBounds(
  value: number | null,
  min: number | null,
  max: number | null,
): boolean {
  if (min === null && max === null) {
    return true;
  }
  if (value === null) {
    return false;
  }

  return (min === null || value >= min) && (max === null || value <= max);
}

function matches(model: FixtureModel, filters: CatalogueFilters): boolean {
  if (filters.category.length > 0) {
    if (model.category === null || !filters.category.includes(model.category)) {
      return false;
    }
  }
  if (filters.priceBand.length > 0) {
    if (model.priceBand === null || !filters.priceBand.includes(model.priceBand)) {
      return false;
    }
  }
  if (filters.manufacturer !== null && model.manufacturerId !== filters.manufacturer) {
    return false;
  }
  if (filters.a2 && model.a2Eligible !== true) {
    return false;
  }

  return (
    withinBounds(model.engineCc, filters.ccMin, filters.ccMax) &&
    withinBounds(model.powerKw, filters.kwMin, filters.kwMax) &&
    withinBounds(model.seatHeightMm, null, filters.seatMax) &&
    withinBounds(model.wetWeightKg, null, filters.weightMax)
  );
}

/** D3's ordering: price sorts put NULLs last in both directions, tiebreak name. */
function compare(a: FixtureModel, b: FixtureModel, sort: CatalogueFilters["sort"]): number {
  if (sort === "name" || sort === "-name") {
    return (sort === "name" ? 1 : -1) * a.name.localeCompare(b.name);
  }

  if (a.msrpEur === null || b.msrpEur === null) {
    if (a.msrpEur === b.msrpEur) {
      return a.name.localeCompare(b.name);
    }

    return a.msrpEur === null ? 1 : -1;
  }
  if (a.msrpEur === b.msrpEur) {
    return a.name.localeCompare(b.name);
  }

  return (sort === "price" ? 1 : -1) * (a.msrpEur - b.msrpEur);
}

/** What the endpoint will do server-side: filter, sort, slice, count. */
async function listModels(filters: CatalogueFilters): Promise<CatalogueModelPage> {
  await sleep(STUB_LATENCY_MS);

  const matching = FIXTURE_MODELS.filter((model) => matches(model, filters));
  const sorted = [...matching].sort((a, b) => compare(a, b, filters.sort));
  const offset = (filters.page - 1) * PAGE_SIZE;

  return {
    items: sorted.slice(offset, offset + PAGE_SIZE).map(toListItem),
    totalCount: matching.length,
  };
}

/** Drops the columns only the server needs, so components see the pinned shape. */
function toListItem(model: FixtureModel): CatalogueListItem {
  return {
    motorbikeId: model.motorbikeId,
    name: model.name,
    manufacturer: model.manufacturer,
    category: model.category,
    priceBand: model.priceBand,
    engineCc: model.engineCc,
    powerKw: model.powerKw,
    wetWeightKg: model.wetWeightKg,
    seatHeightMm: model.seatHeightMm,
    image: model.image,
  };
}

async function listManufacturers(): Promise<Manufacturer[]> {
  await sleep(STUB_LATENCY_MS);

  return [...MANUFACTURERS];
}

// --- Hooks (survive 4.9) ---------------------------------------------------

/**
 * One page of the approved catalogue for the current URL state.
 *
 * `keepPreviousData` is what makes filtering feel instant: the previous grid
 * stays on screen while the next page loads, and the route's reserved progress
 * slot reports the refetch. Every distinct filter/sort/page combination is its
 * own cache entry, keyed by the normalized filter object.
 */
export function useCatalogueModels(
  filters: CatalogueFilters,
): UseQueryResult<CatalogueModelPage, Error> {
  return useQuery({
    queryKey: queryKeys.catalogue.list(filters),
    queryFn: () => listModels(filters),
    placeholderData: keepPreviousData,
  });
}

/**
 * The manufacturer options of the filter select. Near-static, so it is cached
 * for five minutes; a failure leaves the select disabled rather than raising an
 * error surface — the other filters keep working.
 */
export function useManufacturers(): UseQueryResult<Manufacturer[], Error> {
  return useQuery({
    queryKey: queryKeys.manufacturers.list(),
    queryFn: listManufacturers,
    staleTime: 5 * 60_000,
  });
}
