import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import type { components } from "../../api/schema";
import { jsonResponse, stubFetch } from "../../test/network";
import { renderWithProviders } from "../../test/render";

import { AdminBacklogRoute } from "./AdminBacklogRoute";

/**
 * The route runs against a small in-memory `products`/`operations` API behind
 * the `fetch` stub: one model per status, a running ingestion on the `ingesting`
 * one and a failed one on the `backlog` one, so every chip colour, both progress
 * states and both row actions are covered. The `PATCH` really moves its row,
 * which is what makes the "filter now matches nothing" case reachable.
 */

type ProductResource = components["schemas"]["ProductResource"];
type OperationResource = components["schemas"]["OperationResource"];

const IDS = {
  backlog: "01PRODUCTBACKLOG0000000001",
  ingesting: "01PRODUCTINGESTING00000001",
  inReview: "01PRODUCTINREVIEW000000001",
  approved: "01PRODUCTAPPROVED000000001",
  rejected: "01PRODUCTREJECTED000000001",
} as const;

function product(
  id: string,
  attributes: Pick<
    components["schemas"]["ProductAttributes"],
    "name" | "status" | "manufacturer" | "modelName" | "yearFrom" | "yearTo"
  > & { createdAt: string },
): ProductResource {
  return {
    id,
    type: "products",
    attributes: {
      slug: id.toLowerCase(),
      draftSpec: null,
      verifiedSpec: null,
      updatedAt: attributes.createdAt,
      ...attributes,
    },
  };
}

const FIXTURE_PRODUCTS: readonly ProductResource[] = [
  product(IDS.ingesting, {
    name: "Suzuki GSR 600",
    manufacturer: "Suzuki",
    modelName: "GSR 600",
    yearFrom: 2006,
    yearTo: 2011,
    status: "ingesting",
    createdAt: "2026-08-25T09:03:00Z",
  }),
  product(IDS.backlog, {
    name: "Honda CB500F",
    manufacturer: null,
    modelName: null,
    yearFrom: null,
    yearTo: null,
    status: "backlog",
    createdAt: "2026-08-24T08:12:00Z",
  }),
  product(IDS.inReview, {
    name: "Yamaha MT-07",
    manufacturer: "Yamaha",
    modelName: "MT-07",
    yearFrom: 2014,
    yearTo: null,
    status: "in_review",
    createdAt: "2026-08-23T16:30:00Z",
  }),
  product(IDS.approved, {
    name: "Kawasaki Z650",
    manufacturer: "Kawasaki",
    modelName: "Z650",
    yearFrom: 2017,
    yearTo: null,
    status: "approved",
    createdAt: "2026-08-20T10:00:00Z",
  }),
  product(IDS.rejected, {
    name: "BMW G 310 R",
    manufacturer: "BMW",
    modelName: "G 310 R",
    yearFrom: 2016,
    yearTo: null,
    status: "rejected",
    createdAt: "2026-08-18T07:22:00Z",
  }),
];

function operation(
  id: string,
  attributes: Pick<
    components["schemas"]["OperationAttributes"],
    "status" | "progress" | "message" | "entityId"
  >,
): OperationResource {
  return {
    id,
    type: "operations",
    attributes: {
      type: "ingestion",
      error: null,
      entityType: "motorbike",
      createdAt: "2026-08-25T09:03:00Z",
      startedAt: "2026-08-25T09:03:04Z",
      finishedAt: null,
      ...attributes,
    },
  };
}

const FIXTURE_OPERATIONS: readonly OperationResource[] = [
  operation("01OPERATIONRUNNING00000001", {
    status: "running",
    progress: 40,
    message: "Fetching sources (2/6)",
    entityId: IDS.ingesting,
  }),
  operation("01OPERATIONFAILED000000001", {
    status: "failed",
    progress: 15,
    message: "No usable sources could be retrieved",
    entityId: IDS.backlog,
  }),
];

/** The fake API: filtered list reads plus a status `PATCH` that really moves a row. */
function installApi() {
  let products = [...FIXTURE_PRODUCTS];

  stubFetch(async (request) => {
    const url = new URL(request.url);

    if (url.pathname === "/api/operations") {
      return jsonResponse({
        data: FIXTURE_OPERATIONS,
        meta: { totalCount: FIXTURE_OPERATIONS.length },
      });
    }

    if (url.pathname === "/api/products") {
      const status = url.searchParams.get("filter[status]");
      const rows =
        status === null
          ? products
          : products.filter((row) => row.attributes.status === status);

      return jsonResponse({ data: rows, meta: { totalCount: rows.length } });
    }

    if (request.method === "PATCH") {
      const id = url.pathname.split("/").at(-1);
      const body = (await request.json()) as components["schemas"]["ProductPatchRequest"];
      const status = body.data.attributes.status ?? "backlog";

      products = products.map((row) =>
        row.id === id
          ? { ...row, attributes: { ...row.attributes, status } }
          : row,
      );

      return jsonResponse({ data: products.find((row) => row.id === id) });
    }

    throw new Error(`Unexpected ${request.method} ${request.url}`);
  });
}

function LocationProbe() {
  const { search } = useLocation();

  return <output data-testid="search">{search}</output>;
}

function renderRoute() {
  return renderWithProviders(
    <>
      <AdminBacklogRoute />
      <LocationProbe />
    </>,
  );
}

function searchString(): string {
  return screen.getByTestId("search").textContent ?? "";
}

beforeEach(() => {
  installApi();
});

describe("AdminBacklogRoute", () => {
  it("renders a row per model with its live progress and status action", async () => {
    renderRoute();

    expect(await screen.findByText("Suzuki GSR 600")).toBeInTheDocument();

    // The running operation drives the progress cell.
    expect(
      screen.getByRole("progressbar", { name: "Ingestion progress for Suzuki GSR 600" }),
    ).toHaveAttribute("aria-valuenow", "40");
    expect(screen.getByText("40% — Fetching sources (2/6)")).toBeInTheDocument();

    // The `backlog` model has a failed operation, so its action reads "retry"
    // rather than "start".
    const failedRow = screen.getByText("Honda CB500F").closest("tr");
    expect(failedRow).not.toBeNull();
    expect(
      within(failedRow as HTMLElement).getByRole("button", { name: "Retry ingestion" }),
    ).toBeInTheDocument();

    // Review is a link, not a click handler, so middle-click still works.
    const reviewRow = screen.getByText("Yamaha MT-07").closest("tr");
    expect(
      within(reviewRow as HTMLElement).getByRole("link", { name: "Review" }),
    ).toHaveAttribute("href", `/admin/models/${IDS.inReview}`);
  });

  it("round-trips the status filter through the URL", async () => {
    renderRoute();

    await screen.findByText("Suzuki GSR 600");
    expect(searchString()).toBe("");

    await userEvent.click(screen.getByRole("combobox", { name: "Status" }));
    await userEvent.click(screen.getByRole("option", { name: "In review" }));

    // Written to the URL…
    expect(searchString()).toBe("?status=in_review");
    // …and read back from it: both the control and the filtered list derive
    // from the param, not from local state.
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent(
      "In review",
    );
    expect(await screen.findByText("Yamaha MT-07")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Suzuki GSR 600")).not.toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("combobox", { name: "Status" }));
    await userEvent.click(screen.getByRole("option", { name: "All statuses" }));

    expect(searchString()).toBe("");
    expect(await screen.findByText("Suzuki GSR 600")).toBeInTheDocument();
  });

  it("offers to clear the filter when it matches nothing", async () => {
    renderRoute();

    await screen.findByText("Honda CB500F");

    // Retrying the only `backlog` model moves it to `ingesting`, which leaves
    // the `backlog` filter with nothing to show.
    await userEvent.click(screen.getByRole("button", { name: "Retry ingestion" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Retry ingestion" }),
      ).not.toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("combobox", { name: "Status" }));
    await userEvent.click(screen.getByRole("option", { name: "Backlog" }));

    expect(await screen.findByText("No models with this status")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show all statuses" }));

    expect(searchString()).toBe("");
    expect(await screen.findByText("Honda CB500F")).toBeInTheDocument();
  });
});
