import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../test/render";

import { ConsultationChatRoute } from "./ConsultationChatRoute";

/**
 * The conversation state machine of ui-spec §3.3, row by row, plus the composer's
 * keyboard contract — all against the pinned stub fixtures, which exist precisely
 * to make every state reachable before the API does.
 *
 * The chat id normally comes from the path; the route is rendered on its own here
 * (the app's route table is not under test), so `useParams` is doubled.
 */

const CHAT_IDS = {
  interview: "01STUBCHATINTERVIEW0000000",
  typing: "01STUBCHATTYPING0000000000",
  stale: "01STUBCHATSTALE00000000000",
  new: "01STUBCHATNEW0000000000000",
  empty: "01STUBCHATEMPTY00000000000",
} as const;

let chatIdParam: string = CHAT_IDS.interview;

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();

  return { ...actual, useParams: () => ({ chatId: chatIdParam }) };
});

/** The composer input; also the target of every keyboard interaction. */
function composer(): HTMLElement {
  return screen.getByRole("textbox", { name: "Message" });
}

function sendButton(): HTMLElement {
  return screen.getByRole("button", { name: "Send" });
}

beforeEach(() => {
  chatIdParam = CHAT_IDS.interview;
});

describe("ConsultationChatRoute — turn states", () => {
  it("row 5: an idle conversation shows its messages and nothing else", async () => {
    renderWithProviders(<ConsultationChatRoute />);

    const timeline = await screen.findByRole("log", { name: "Conversation" });

    // The advisor speaks first, and its Markdown renders (GFM table included).
    expect(within(timeline).getByRole("table")).toBeInTheDocument();
    // No turn is in flight: no typing bubble, no failed-turn row, no captions.
    expect(
      screen.queryByRole("status", { name: "The advisor is typing…" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Seen")).not.toBeInTheDocument();
    expect(screen.queryByText(/could not finish this reply/)).not.toBeInTheDocument();
  });

  it("row 3: an active turn shows the typing bubble and a Seen caption", async () => {
    chatIdParam = CHAT_IDS.typing;

    renderWithProviders(<ConsultationChatRoute />);

    expect(
      await screen.findByRole("status", { name: "The advisor is typing…" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Seen")).toBeInTheDocument();

    // The field stays editable — drafting while the advisor types is fine — but
    // sending waits for the turn to end.
    await userEvent.type(composer(), "One more thing");
    expect(composer()).toBeEnabled();
    expect(sendButton()).toBeDisabled();
  });

  it("row 3: the greeting turn shows the typing bubble without a Seen caption", async () => {
    chatIdParam = CHAT_IDS.new;

    renderWithProviders(<ConsultationChatRoute />);

    expect(
      await screen.findByRole("status", { name: "The advisor is typing…" }),
    ).toBeInTheDocument();
    // Nobody has said anything yet, so there is nothing to have been seen.
    expect(screen.queryByText("Seen")).not.toBeInTheDocument();
  });

  it("row 4: a stale turn replaces the typing bubble and re-enables sending", async () => {
    chatIdParam = CHAT_IDS.stale;

    renderWithProviders(<ConsultationChatRoute />);

    expect(
      await screen.findByText(/The advisor could not finish this reply/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("status", { name: "The advisor is typing…" }),
    ).not.toBeInTheDocument();

    await userEvent.type(composer(), "Trying again");
    expect(sendButton()).toBeEnabled();
  });

  it("an empty idle chat shows the intro hint instead of a timeline", async () => {
    chatIdParam = CHAT_IDS.empty;

    renderWithProviders(<ConsultationChatRoute />);

    expect(
      await screen.findByText("Tell the advisor about yourself"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("log")).not.toBeInTheDocument();
    expect(composer()).toBeEnabled();
  });

  it("answers an unknown chat with the not-found gate", async () => {
    chatIdParam = "01STUBCHATGONE00000000000X";

    // A nested provider, only here: the application retries a failed query three
    // times with backoff (~7 s), and this test is about the gate, not the wait.
    // The page-level spinner is what the user sees until then.
    renderWithProviders(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ConsultationChatRoute />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(await screen.findByText("Consultation not found")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("ConsultationChatRoute — composer", () => {
  it("row 1: Enter sends and the bubble reports its own progress", async () => {
    const user = userEvent.setup();

    renderWithProviders(<ConsultationChatRoute />);
    await screen.findByRole("log", { name: "Conversation" });

    await user.type(composer(), "I ride 20 km a day.{Enter}");

    // The optimistic bubble is on screen before the request resolves, and the
    // composer is cleared immediately (the bubble now holds the text).
    expect(screen.getByText("Sending…")).toBeInTheDocument();
    expect(screen.getByText("I ride 20 km a day.")).toBeInTheDocument();
    expect(composer()).toHaveValue("");

    // A successful POST *is* the "seen" signal, and the advisor's turn begins.
    await waitFor(() => {
      expect(screen.getByText("Seen")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("status", { name: "The advisor is typing…" }),
    ).toBeInTheDocument();
  });

  it("inserts a newline on Shift+Enter instead of sending", async () => {
    const user = userEvent.setup();

    chatIdParam = CHAT_IDS.empty;
    renderWithProviders(<ConsultationChatRoute />);
    await screen.findByText("Tell the advisor about yourself");

    await user.type(composer(), "First line{Shift>}{Enter}{/Shift}second line");

    expect(composer()).toHaveValue("First line\nsecond line");
    expect(screen.queryByText("Sending…")).not.toBeInTheDocument();
  });

  it("refuses an over-length message without sending it", async () => {
    chatIdParam = CHAT_IDS.empty;
    renderWithProviders(<ConsultationChatRoute />);
    await screen.findByText("Tell the advisor about yourself");

    // Pasted, not typed: 4001 keystrokes would take longer than the test.
    fireEvent.change(composer(), { target: { value: "x".repeat(4001) } });

    expect(screen.getByText("This message is too long.")).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
  });

  it("row 2: a failed send keeps the text and offers retry and discard", async () => {
    const user = userEvent.setup();

    chatIdParam = CHAT_IDS.empty;
    renderWithProviders(<ConsultationChatRoute />);
    await screen.findByText("Tell the advisor about yourself");

    // The stub's magic input, so the failure path is reachable without a server.
    await user.type(composer(), "fail{Enter}");
    expect(await screen.findByText("Not sent.")).toBeInTheDocument();
    // The composer is usable again, and the text lives in the bubble.
    expect(sendButton()).toBeDisabled();
    expect(screen.getByText("fail")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Send again" }));
    expect(screen.getByText("Sending…")).toBeInTheDocument();
    expect(await screen.findByText("Not sent.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByText("Not sent.")).not.toBeInTheDocument();
    expect(screen.queryByText("fail")).not.toBeInTheDocument();
  });
});
