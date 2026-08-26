import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";

import { AdminBacklogRoute } from "./AdminBacklogRoute";

/**
 * The route runs against the `useProducts`/`useOperations` stubs (both replaced
 * in step 2.15): one model per status, a running ingestion on the `ingesting`
 * one and a failed one on the `backlog` one.
 */
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

describe("AdminBacklogRoute", () => {
  it("renders a row per model with its live progress and status action", async () => {
    renderRoute();

    expect(await screen.findByText("Suzuki GSR 600")).toBeInTheDocument();

    // The running fixture operation drives the progress cell.
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
    ).toHaveAttribute("href", "/admin/models/01STUBPRODUCTINREVIEW00001");
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
    expect(screen.queryByText("Suzuki GSR 600")).not.toBeInTheDocument();

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
