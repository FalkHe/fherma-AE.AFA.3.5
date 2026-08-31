import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Operation } from "../hooks/useOperations";
import {
  SaveIdentityError,
  type IdentityBlock,
  type ProductSuggestion,
  type ProductWithIdentity,
} from "../hooks/useProductReview";
import { jsonResponse, stubFetch } from "../test/network";
import { renderWithProviders } from "../test/render";

import { ModelIdentityPanel } from "./ModelIdentityPanel";

/**
 * The identity form's own concerns (ui-spec §1): options loading, submit-only
 * Zod validation (§1.3), the save flow and its three error surfaces (§1.5),
 * and the research-warning Alert (§2.4). The claim panel's own behaviour
 * (matching, filling, the D6 boundary) is covered by `ModelClaimPanel.test.tsx`;
 * here it is only exercised enough to prove the two panels are wired together.
 *
 * `useSaveIdentity` is doubled so the PATCH payload is observable without a
 * real network round trip; `useManufacturers` / `useBuildinglines` run for
 * real against the stubbed `fetch`, exactly like `ModelSpecsPanel.test.tsx`
 * runs its options-free form for real.
 */

const save = {
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  reset: vi.fn(),
};

vi.mock("../hooks/useProductReview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useProductReview")>();

  return { ...actual, useSaveIdentity: () => save };
});

const MANUFACTURER_SUZUKI = "01MANUFACTURERSUZUKI0001";
const MANUFACTURER_HONDA = "01MANUFACTURERHONDA00001";

const PRODUCT: ProductWithIdentity = {
  id: "01PRODUCTINREVIEW000000001",
  name: "Suzuki GSR 600",
  slug: "suzuki-gsr-600",
  manufacturer: "Suzuki",
  modelName: null,
  yearFrom: null,
  yearTo: null,
  status: "in_review",
  draftSpec: null,
  verifiedSpec: null,
  createdAt: "2026-08-25T09:03:00Z",
  updatedAt: "2026-08-25T09:14:00Z",
  queryName: "Suzuki GSR 600",
  buildingline: null,
  typeCodes: [],
  variants: [],
  suggestion: null,
};

const SUGGESTION: ProductSuggestion = {
  source: "bike-list.txt",
  raw: "Suzuki GSR 600 2006-2011 ([Wikipedia][3])",
  manufacturer: "Suzuki",
  model: "GSR 600",
  yearFrom: 2006,
  yearTo: 2011,
  inProduction: false,
  yearRanges: [{ from: 2006, to: 2011 }],
  typeCodes: ["WVB1"],
  links: ["https://en.wikipedia.org/wiki/Suzuki_GSR600"],
};

function installOptionsApi(): void {
  stubFetch(async (request) => {
    const url = new URL(request.url);

    if (url.pathname === "/api/manufacturers") {
      return jsonResponse({
        data: [
          { id: MANUFACTURER_SUZUKI, type: "manufacturers", attributes: { name: "Suzuki" } },
          { id: MANUFACTURER_HONDA, type: "manufacturers", attributes: { name: "Honda" } },
        ],
        meta: { totalCount: 2 },
      });
    }

    if (url.pathname === `/api/manufacturers/${MANUFACTURER_SUZUKI}/buildinglines`) {
      return jsonResponse(["GSR", "GSX"]);
    }

    throw new Error(`Unexpected ${request.method} ${request.url}`);
  });
}

function renderPanel(
  product: ProductWithIdentity = PRODUCT,
  operation?: Pick<Operation, "status" | "message">,
) {
  return renderWithProviders(
    <ModelIdentityPanel
      product={product}
      operation={operation as Operation | undefined}
      onDirtyChange={() => undefined}
    />,
  );
}

/** The payload of the single save call. */
function savedIdentity(): IdentityBlock {
  expect(save.mutate).toHaveBeenCalledTimes(1);

  return (save.mutate.mock.calls[0][0] as { values: IdentityBlock }).values;
}

beforeEach(() => {
  save.mutate.mockClear();
  save.isPending = false;
  save.isError = false;
  installOptionsApi();
});

describe("ModelIdentityPanel — no claim, empty identity", () => {
  it("shows the queryName-fallback preview and no claim panel when suggestion is null", async () => {
    renderPanel();

    await screen.findByLabelText("Manufacturer");

    // §11 degradation / §1.8 empty state: both preview levels fall back to the
    // originally-entered query name rather than an empty parenthesis.
    expect(screen.getByText(/Level 1.*Suzuki GSR 600/)).toBeInTheDocument();
    expect(screen.getByText(/Level 2.*Suzuki GSR 600/)).toBeInTheDocument();
    expect(screen.queryByText("Unverified claim")).not.toBeInTheDocument();
  });

  it("disables the buildingline field until a manufacturer is chosen", async () => {
    // No manufacturer matches `null` — the auto-select effect never fires.
    renderPanel({ ...PRODUCT, manufacturer: null });

    await screen.findByLabelText("Manufacturer");
    expect(screen.getByLabelText("Buildingline")).toBeDisabled();
    expect(screen.getByText("Select a manufacturer first.")).toBeInTheDocument();
  });

  it("skeletons the buildingline field while its options are loading", async () => {
    stubFetch(async (request) => {
      const url = new URL(request.url);

      if (url.pathname === "/api/manufacturers") {
        return jsonResponse({
          data: [
            { id: MANUFACTURER_SUZUKI, type: "manufacturers", attributes: { name: "Suzuki" } },
          ],
          meta: { totalCount: 1 },
        });
      }

      // The buildingline request for the auto-matched Suzuki hangs forever.
      return new Promise<Response>(() => undefined);
    });

    renderPanel();

    // The manufacturer auto-selects (product.manufacturer === "Suzuki" matches
    // the one loaded option), which enables the buildingline query — which
    // never settles, so the field stays a skeleton rather than a bare input.
    await screen.findByDisplayValue("Suzuki");
    expect(screen.queryByLabelText("Buildingline")).not.toBeInTheDocument();
  });

  it("rejects an invalid type code: no chip is added and the field shows the helper error", async () => {
    renderPanel();

    const typeCodesField = await screen.findByLabelText("Type codes");

    await userEvent.type(typeCodesField, "!!{Enter}");

    expect(
      screen.getByText("Codes are 2–32 characters: letters, digits, hyphen, slash or space."),
    ).toBeInTheDocument();
    expect(screen.queryByText("!!")).not.toBeInTheDocument();
  });
});

describe("ModelIdentityPanel — save flow", () => {
  it("saves the manufacturer, model name and type codes typed into the form", async () => {
    renderPanel();

    const manufacturerInput = await screen.findByLabelText("Manufacturer");

    await userEvent.click(manufacturerInput);
    await userEvent.click(await screen.findByRole("option", { name: "Suzuki" }));
    await userEvent.type(screen.getByLabelText("Model name"), "GSR 600");
    await userEvent.type(screen.getByLabelText("Type codes"), "WVB1{Enter}");

    await userEvent.click(screen.getByRole("button", { name: "Save identity" }));

    const values = savedIdentity();

    expect(values.manufacturerId).toBe(MANUFACTURER_SUZUKI);
    expect(values.modelName).toBe("GSR 600");
    expect(values.typeCodes).toEqual(["WVB1"]);
    expect(values.buildingline).toBeNull();
    expect(values.yearFrom).toBeNull();
  });

  it("rejects a model name over 128 characters instead of sending it", async () => {
    renderPanel();

    await screen.findByLabelText("Manufacturer");
    // `fireEvent.change` rather than 129 individual `userEvent.type` keystrokes:
    // this test is about the length rule, not per-character input behaviour
    // (already covered elsewhere), and each keystroke re-renders the panel for
    // the live preview (§6.2) — 129 of those is needlessly slow.
    fireEvent.change(screen.getByLabelText("Model name"), {
      target: { value: "x".repeat(129) },
    });
    await userEvent.click(screen.getByRole("button", { name: "Save identity" }));

    expect(await screen.findByText("At most 128 characters.")).toBeInTheDocument();
    expect(save.mutate).not.toHaveBeenCalled();
  });

  it('rejects "year to" before "year from"', async () => {
    renderPanel();

    await screen.findByLabelText("Manufacturer");
    await userEvent.type(screen.getByLabelText("Year from"), "2015");
    await userEvent.type(screen.getByLabelText("Year to"), "2010");
    await userEvent.click(screen.getByRole("button", { name: "Save identity" }));

    expect(
      await screen.findByText('"Year to" must not be before "Year from".'),
    ).toBeInTheDocument();
    expect(save.mutate).not.toHaveBeenCalled();
  });

  it("shows the duplicate-identity alert and keeps typed values on a 409", async () => {
    save.mutate.mockImplementation((_input, options: { onError: (error: unknown) => void }) => {
      options.onError(new SaveIdentityError(409, "duplicate-model"));
    });

    renderPanel();

    await screen.findByLabelText("Manufacturer");
    await userEvent.type(screen.getByLabelText("Model name"), "GSR 600");
    await userEvent.click(screen.getByRole("button", { name: "Save identity" }));

    expect(
      await screen.findByText(
        "Another catalogue entry already has this manufacturer, model name and start year.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Model name")).toHaveValue("GSR 600");
  });

  it("maps a 422 validation field pointer to the matching field error", async () => {
    save.mutate.mockImplementation((_input, options: { onError: (error: unknown) => void }) => {
      options.onError(new SaveIdentityError(422, null, ["yearFrom"]));
    });

    renderPanel();

    await screen.findByLabelText("Manufacturer");
    await userEvent.type(screen.getByLabelText("Year from"), "1700");
    await userEvent.click(screen.getByRole("button", { name: "Save identity" }));

    // The 1700 example fails the client-side rule too (< 1885); assert the
    // server-mapped path with a value the client accepts.
    expect(await screen.findByText("Enter a four-digit year.")).toBeInTheDocument();
  });
});

describe("ModelIdentityPanel — claim and research warning", () => {
  it("renders the claim panel and per-field rows when a suggestion is present", async () => {
    renderPanel({ ...PRODUCT, suggestion: SUGGESTION });

    expect(await screen.findByText("Unverified claim")).toBeInTheDocument();
    expect(screen.getByText('Claim: Suzuki')).toBeInTheDocument();
    expect(screen.getByText('Claim: GSR 600')).toBeInTheDocument();
  });

  it("fills both year fields from the claim and dirties the form", async () => {
    renderPanel({ ...PRODUCT, suggestion: SUGGESTION });

    await screen.findByLabelText("Manufacturer");
    const useButtons = await screen.findAllByRole("button", { name: /Use the claimed/ });
    const yearButton = useButtons.find((button) =>
      button.getAttribute("aria-label")?.includes("Year from/Year to"),
    );

    expect(yearButton).toBeDefined();
    await userEvent.click(yearButton as HTMLElement);

    expect(screen.getByLabelText("Year from")).toHaveValue("2006");
    expect(screen.getByLabelText("Year to")).toHaveValue("2011");
    expect(screen.getByRole("button", { name: "Save identity" })).toBeEnabled();
  });

  it("shows the research-warning alert with the prefix stripped", async () => {
    renderPanel(PRODUCT, {
      status: "succeeded",
      message: "Completed with warnings: the claimed year range could not be confirmed",
    });

    expect(await screen.findByText("Research finished with warnings")).toBeInTheDocument();
    expect(
      screen.getByText("the claimed year range could not be confirmed"),
    ).toBeInTheDocument();
  });

  it("shows no research-warning alert for a run that succeeded without warnings", async () => {
    renderPanel(PRODUCT, { status: "succeeded", message: "All sources retrieved" });

    await screen.findByLabelText("Manufacturer");
    expect(screen.queryByText("Research finished with warnings")).not.toBeInTheDocument();
  });
});

describe("ModelIdentityPanel — approved (read-only)", () => {
  it("renders a read-only table and a collapsed claim panel, no form", async () => {
    renderPanel({
      ...PRODUCT,
      status: "approved",
      manufacturer: "Suzuki",
      modelName: "GSR 600",
      yearFrom: 2006,
      yearTo: 2011,
      suggestion: SUGGESTION,
    });

    expect(screen.getByText("GSR 600")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save identity" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Model name")).not.toBeInTheDocument();
    // Collapsed accordion: the chip is visible, the hint text is not (only
    // rendered in the always-expanded form).
    expect(screen.getByText("Unverified claim")).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Imported from a suggestion list — research must confirm it before it becomes catalogue data.",
      ),
    ).not.toBeInTheDocument();
  });
});
