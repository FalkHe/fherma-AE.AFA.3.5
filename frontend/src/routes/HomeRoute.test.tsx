import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { jsonResponse, stubFetch } from "../test/network";
import { renderWithProviders } from "../test/render";

import { HomeRoute } from "./HomeRoute";

describe("HomeRoute", () => {
  it("renders the shell copy and the backend health widget", async () => {
    stubFetch(() => jsonResponse({ status: "ok" }));

    renderWithProviders(<HomeRoute />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Welcome");
    expect(
      screen.getByText("Advice from a curated catalogue, not from marketing copy."),
    ).toBeInTheDocument();
    expect(await screen.findByText("Backend: OK")).toBeInTheDocument();
  });
});
