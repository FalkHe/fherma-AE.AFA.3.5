import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { jsonResponse, stubFetch, stubPendingFetch } from "../test/network";
import { renderWithProviders } from "../test/render";

import { HealthStatus } from "./HealthStatus";

// The failure path retries once after 500ms (see useHealth), so give the
// assertion more room than Testing Library's 1s default.
const UNREACHABLE_TIMEOUT_MS = 3000;

describe("HealthStatus", () => {
  it("shows the check as running while the request is in flight", () => {
    stubPendingFetch();

    renderWithProviders(<HealthStatus />);

    expect(screen.getByRole("status")).toHaveTextContent("Checking backend…");
  });

  it("reports a healthy backend and calls GET /health to find out", async () => {
    const requests: Request[] = [];
    stubFetch((request) => {
      requests.push(request);
      return jsonResponse({ status: "ok" });
    });

    renderWithProviders(<HealthStatus />);

    // The widget starts in its checking state, so wait for the resolved label
    // rather than for the (immediately present) status role.
    expect(await screen.findByText("Backend: OK")).toBeInTheDocument();
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("GET");
    expect(new URL(requests[0].url).pathname).toBe("/health");
  });

  it("reports an unreachable backend, with a hint, when /health fails", async () => {
    stubFetch(() => new Response(null, { status: 503 }));

    renderWithProviders(<HealthStatus />);

    expect(
      await screen.findByText(
        "Backend: unreachable",
        {},
        { timeout: UNREACHABLE_TIMEOUT_MS },
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The API did not answer. Check that the backend is running."),
    ).toBeInTheDocument();
  });
});
