import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../test/render";

import { ConsultationsRoute } from "./ConsultationsRoute";

/**
 * The consultation list against the pinned stub fixtures: what a row shows, and
 * the delete affordance end to end (row → confirmation → row gone).
 */

describe("ConsultationsRoute", () => {
  it("lists the consultations with their last activity and the replying hint", async () => {
    renderWithProviders(<ConsultationsRoute />);

    const list = await screen.findByRole("list", { name: "Your consultations" });
    const rows = within(list).getAllByRole("listitem");

    // Five fixture consultations, last activity first.
    expect(rows).toHaveLength(5);
    expect(
      within(list).getByRole("link", { name: /Commuter bike for the city/ }),
    ).toHaveAttribute("href", "/consultations/01STUBCHATINTERVIEW0000000");
    // A chat with a turn in flight says so in words, not only in colour.
    expect(within(list).getAllByText("Advisor is replying…")).not.toHaveLength(0);
    // A chat the server has not titled yet falls back to a label.
    expect(within(list).getAllByText("New consultation")).not.toHaveLength(0);
    // Every row can be deleted.
    expect(
      within(list).getAllByRole("button", { name: "Delete consultation" }),
    ).toHaveLength(5);
  });

  it("deletes a consultation after the confirmation dialog", async () => {
    const user = userEvent.setup();

    renderWithProviders(<ConsultationsRoute />);

    const list = await screen.findByRole("list", { name: "Your consultations" });
    const row = within(list)
      .getByRole("link", { name: /Commuter bike for the city/ })
      .closest("li");

    if (row === null) {
      throw new Error("The consultation row is not a list item.");
    }

    await user.click(
      within(row).getByRole("button", { name: "Delete consultation" }),
    );

    const dialog = await screen.findByRole("dialog");

    // The title is interpolated, so it is clear which conversation goes away.
    expect(
      within(dialog).getByText(/“Commuter bike for the city” and its conversation/),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    // The dialog closes on success first — while it is open MUI hides the rest
    // of the page from the accessibility tree, so the row cannot be asserted on
    // until then.
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(
      screen.queryByRole("link", { name: /Commuter bike for the city/ }),
    ).not.toBeInTheDocument();
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(4);
  });
});
