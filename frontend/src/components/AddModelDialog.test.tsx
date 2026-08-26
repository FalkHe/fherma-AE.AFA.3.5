import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../test/render";

import { AddModelDialog } from "./AddModelDialog";

/**
 * The dialog runs against the `useProducts` stub (step 2.15 replaces it with
 * the real endpoint), which answers after a short delay and rejects a name
 * that is already in the fixture catalogue with the pinned 409.
 */
function renderDialog() {
  const onClose = vi.fn();
  const onCreated = vi.fn();

  renderWithProviders(<AddModelDialog onClose={onClose} onCreated={onCreated} />);

  return {
    onClose,
    onCreated,
    nameField: screen.getByRole("textbox", { name: /Model name/ }),
    submit: screen.getByRole("button", { name: "Add & start ingestion" }),
  };
}

describe("AddModelDialog", () => {
  it("rejects a blank name on submit without calling the server", async () => {
    const { nameField, submit, onCreated } = renderDialog();

    await userEvent.type(nameField, "   ");
    await userEvent.click(submit);

    expect(screen.getByText("Enter a model name.")).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    // Still interactive: nothing was submitted.
    expect(submit).toBeEnabled();
  });

  it("reports a duplicate model on the name field", async () => {
    const { nameField, submit, onCreated } = renderDialog();

    await userEvent.type(nameField, "Honda CB500F");
    await userEvent.click(submit);

    expect(
      await screen.findByText("This model is already in the catalogue."),
    ).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    // The typed value survives, so a correction costs no retyping.
    expect(nameField).toHaveValue("Honda CB500F");
  });

  it("disables the form while the creation is in flight and reports success", async () => {
    const { nameField, submit, onCreated, onClose } = renderDialog();

    await userEvent.type(nameField, "Triumph Trident 660");
    await userEvent.click(submit);

    expect(submit).toBeDisabled();
    expect(nameField).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1);
    });
    // Closing is the caller's job (it also clears the status filter).
    expect(onClose).not.toHaveBeenCalled();
  });
});
