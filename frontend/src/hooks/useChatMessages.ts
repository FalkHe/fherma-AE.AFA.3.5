import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { queryKeys } from "../queryKeys";

/**
 * STUB — the whole file is replaced wholesale in step 3.6, when the
 * `chat-messages` endpoints reach the generated API client. The exported names,
 * the argument shapes, the message/part shapes and the query keys are pinned by
 * `docs/roadmap/phase-3/shared-knowledge.md` (§Frontend conventions,
 * §Persisted JSONB shapes, §Tool result schemas); do not change them, and do
 * not import anything from here that 3.6 will not still export.
 *
 * What is real here: the TanStack Query plumbing, including the one optimistic
 * update this application is allowed to perform (ui-spec §3.2 — the user's own
 * outgoing message). The hooks return genuine `useQuery`/`useMutation` results
 * over an in-memory fixture conversation, keyed and invalidated exactly as the
 * live versions will be, so the components written against them survive the
 * replacement without edits. Only the "stub server" section goes away in 3.6.
 */

// --- Contract types (survive 3.6) ------------------------------------------

/**
 * One retrieved chunk behind an assistant answer, as persisted in
 * `chat_messages.sources` (shared-knowledge §Persisted JSONB shapes).
 */
export interface MessageSource {
  chunkId: string;
  motorbikeId: string;
  sourceDocumentId: string;
  sourceUrl: string | null;
  sourceTitle: string;
  headingPath: string | null;
  score: number;
}

/**
 * One executed tool call, as persisted in `chat_messages.tool_calls`.
 *
 * `arguments` and `result` are deliberately open objects: every tool has its own
 * result schema (shared-knowledge §Tool result schemas) and the renderers of
 * step 3.10 shape-check what they get, so a tool the frontend predates still
 * renders through the generic fallback instead of crashing.
 */
export interface ToolCall {
  id: string;
  tool: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
  status: "succeeded" | "failed";
  error: string | null;
}

/**
 * One recommended model, as persisted in `chat_messages.recommendations`: a
 * write-time snapshot, so a card is self-contained and needs no catalogue read.
 */
export interface Recommendation {
  motorbikeId: string;
  name: string;
  /** Card-variant media path, or `null` when the model publishes no image. */
  imageUrl: string | null;
  rationale: string;
  matchedPreferences: string[];
  keySpecs: {
    category: string | null;
    engineCc: number | null;
    powerKw: number | null;
    wetWeightKg: number | null;
    seatHeightMm: number | null;
    priceBand: string | null;
  };
}

/**
 * One message of a conversation.
 *
 * `localId` and `state` are **client-side only** — they exist while the user's
 * own outgoing message is in flight (ui-spec §3.2/§6) and are absent on every
 * row the server delivers. A refetch therefore replaces an optimistic entry
 * with the server row and the caption falls back to the timestamp.
 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  body: string;
  toolCalls: ToolCall[];
  sources: MessageSource[];
  recommendations: Recommendation[];
  createdAt: string;
  /** Client-side correlation id of an optimistic outgoing message. */
  localId?: string;
  /** Send state of an optimistic outgoing message. */
  state?: "sending" | "sent" | "failed";
}

/**
 * A failed chat call, carrying what the screens branch on.
 *
 * Same shape and rationale as `ProductError`: the backend's `detail` is English
 * prose for developers, so the UI decides its own message from the status code
 * (404 → "not found", 409 `response-pending` → a quiet refetch, anything else →
 * "server error"). `code` is the stable application code of a JSON:API domain
 * error and `null` for the shapes that carry none. Never branch on `detail`.
 */
export class ChatError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null = null) {
    super(`Chat request failed with status ${status}`);
    this.name = "ChatError";
    this.status = status;
    this.code = code;
  }
}

// --- Stub server (deleted in 3.6) ------------------------------------------

/** Chat ids of the fixture conversations; mirrored in `useChats.ts`. */
const CHAT_IDS = {
  interview: "01STUBCHATINTERVIEW0000000",
  typing: "01STUBCHATTYPING0000000000",
  stale: "01STUBCHATSTALE00000000000",
  new: "01STUBCHATNEW0000000000000",
  empty: "01STUBCHATEMPTY00000000000",
} as const;

/** Round trip long enough to make `sending` observable before it flips to seen. */
const STUB_SEND_LATENCY_MS = 800;

/** How long the advisor "thinks" before a stubbed reply lands. */
const STUB_REPLY_DELAY_MS = 1_500;

/** The magic input of ui-spec §12: sending this exercises the failed bubble. */
const STUB_FAILING_BODY = "fail";

/** Absolute timestamps, so the fixture proves the second `Intl` format (§6). */
const OLDER_DAY = {
  greeting: "2026-08-25T09:02:00Z",
  firstUser: "2026-08-25T09:04:00Z",
} as const;

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function emptyParts(): Pick<ChatMessage, "toolCalls" | "sources" | "recommendations"> {
  return { toolCalls: [], sources: [], recommendations: [] };
}

/**
 * The kitchen-sink assistant message's tool calls: all four styled renderers,
 * both subtle bookkeeping rows and one tool the frontend does not know, so the
 * generic fallback of step 3.10 has something to render. Every `result` matches
 * the pinned schemas of shared-knowledge §"Tool result schemas".
 */
const KITCHEN_SINK_TOOL_CALLS: ToolCall[] = [
  {
    id: "call-catalogue-search",
    tool: "catalogue_search",
    arguments: { category: "naked", a2Eligible: true, maxSeatHeightMm: 800 },
    result: {
      results: [
        {
          motorbikeId: "01STUBBIKECB500F0000000001",
          name: "Honda CB500F",
          category: "naked",
          powerKw: 35.0,
          wetWeightKg: 189.0,
          seatHeightMm: 785,
          priceBand: "mid",
        },
        {
          motorbikeId: "01STUBBIKEZ650000000000001",
          name: "Kawasaki Z650",
          category: "naked",
          powerKw: 35.0,
          wetWeightKg: 187.0,
          seatHeightMm: 790,
          priceBand: "mid",
        },
        {
          motorbikeId: "01STUBBIKESVARTPILEN000001",
          name: "Husqvarna Svartpilen 401",
          category: null,
          powerKw: null,
          wetWeightKg: null,
          seatHeightMm: null,
          priceBand: null,
        },
      ],
      totalCount: 11,
    },
    status: "succeeded",
    error: null,
  },
  {
    id: "call-spec-comparison",
    tool: "spec_comparison",
    arguments: {
      motorbikeIds: [
        "01STUBBIKECB500F0000000001",
        "01STUBBIKEZ650000000000001",
        "01STUBBIKEMT07000000000001",
      ],
    },
    result: {
      bikes: [
        { motorbikeId: "01STUBBIKECB500F0000000001", name: "Honda CB500F" },
        { motorbikeId: "01STUBBIKEZ650000000000001", name: "Kawasaki Z650" },
        { motorbikeId: "01STUBBIKEMT07000000000001", name: "Yamaha MT-07" },
      ],
      rows: [
        { field: "category", values: ["naked", "naked", "naked"] },
        { field: "engineCc", values: [471, 649, 689] },
        { field: "powerKw", values: [35.0, 50.2, 54.0] },
        { field: "torqueNm", values: [43.0, null, 67.0] },
        { field: "wetWeightKg", values: [189.0, 187.0, 184.0] },
        { field: "seatHeightMm", values: [785, 790, null] },
        { field: "topSpeedKmh", values: [null, null, 205] },
        { field: "priceBand", values: ["mid", "mid", "mid"] },
      ],
    },
    status: "succeeded",
    error: null,
  },
  {
    id: "call-licence-fit-check",
    tool: "licence_fit_check",
    arguments: { motorbikeId: "01STUBBIKECB500F0000000001", licence: "a2", riderHeightCm: 165 },
    result: {
      motorbikeId: "01STUBBIKECB500F0000000001",
      name: "Honda CB500F",
      rules: [
        {
          rule: "a2_power",
          label: "A2 power limit",
          verdict: "pass",
          evidence: "35.0 kW ≤ 35 kW",
        },
        {
          rule: "a2_power_to_weight",
          label: "A2 power-to-weight limit",
          verdict: "fail",
          evidence: "35.0 kW / 189 kg = 0.185 kW/kg > 0.2 kW/kg is not met by the restricted variant",
        },
        {
          rule: "seat_height_fit",
          label: "Seat height fit for 165 cm",
          verdict: "unknown",
          evidence: "seat height not verified for this model year",
        },
      ],
    },
    status: "succeeded",
    error: null,
  },
  {
    id: "call-cost-estimator",
    tool: "cost_estimator",
    arguments: { motorbikeId: "01STUBBIKECB500F0000000001", annualKm: 8000 },
    result: {
      motorbikeId: "01STUBBIKECB500F0000000001",
      name: "Honda CB500F",
      currency: "EUR",
      lineItems: [
        { label: "Insurance /year", amount: 620 },
        { label: "Tyres /year", amount: 340 },
        { label: "Service & maintenance /year", amount: 480 },
        { label: "Fuel /year (8,000 km)", amount: 700 },
      ],
      total: 2140,
      assumptions: [
        "8,000 km per year, mixed city and country roads",
        "Third-party insurance for a rider aged 25 with no claims",
        "Dealer service intervals at the manufacturer's schedule",
      ],
      coefficientsVersion: "2026.1",
    },
    status: "succeeded",
    error: null,
  },
  {
    id: "call-flag-unknown-bike",
    tool: "flag_unknown_bike",
    arguments: { name: "Voge 500R" },
    result: { name: "Voge 500R", status: "queued" },
    status: "succeeded",
    error: null,
  },
  {
    id: "call-some-future-tool",
    tool: "some_future_tool",
    arguments: { query: "insurance groups" },
    result: {
      verdict: "inconclusive",
      details: { checked: 3, matched: 0 },
    },
    status: "succeeded",
    error: null,
  },
];

/**
 * Three sources, one carrying a `headingPath` and one repeating an earlier URL —
 * the duplicate is what proves the de-duplication rule of ui-spec §7.
 */
const KITCHEN_SINK_SOURCES: MessageSource[] = [
  {
    chunkId: "01STUBCHUNK000000000000001",
    motorbikeId: "01STUBBIKECB500F0000000001",
    sourceDocumentId: "01STUBDOC00000000000000001",
    sourceUrl: "https://en.wikipedia.org/wiki/Honda_CB500F",
    sourceTitle: "Honda CB500F",
    headingPath: "Honda CB500F > Reception",
    score: 0.042,
  },
  {
    chunkId: "01STUBCHUNK000000000000002",
    motorbikeId: "01STUBBIKEZ650000000000001",
    sourceDocumentId: "01STUBDOC00000000000000002",
    sourceUrl: "https://www.motorcyclenews.com/reviews/kawasaki/z650/",
    sourceTitle: "Kawasaki Z650 (2017–) review",
    headingPath: null,
    score: 0.031,
  },
  {
    chunkId: "01STUBCHUNK000000000000003",
    motorbikeId: "01STUBBIKECB500F0000000001",
    sourceDocumentId: "01STUBDOC00000000000000001",
    sourceUrl: "https://en.wikipedia.org/wiki/Honda_CB500F",
    sourceTitle: "Honda CB500F",
    headingPath: "Honda CB500F > Reception",
    score: 0.028,
  },
];

/** Two cards: one with an image variant path, one without (fallback box, §9). */
const KITCHEN_SINK_RECOMMENDATIONS: Recommendation[] = [
  {
    motorbikeId: "01STUBBIKECB500F0000000001",
    name: "Honda CB500F",
    imageUrl: "/media/motorbikes/01STUBBIKECB500F0000000001/01STUBIMAGE000000000000001_card.webp",
    rationale: "A2-legal, low seat and the mildest clutch in this class — forgiving for a first big bike.",
    matchedPreferences: ["a2", "budget", "city"],
    keySpecs: {
      category: "naked",
      engineCc: 471,
      powerKw: 35.0,
      wetWeightKg: 189.0,
      seatHeightMm: 785,
      priceBand: "mid",
    },
  },
  {
    motorbikeId: "01STUBBIKEZ650000000000001",
    name: "Kawasaki Z650",
    imageUrl: null,
    rationale: "Slightly livelier twin with the same friendly weight, if you want room to grow.",
    matchedPreferences: ["a2", "city"],
    keySpecs: {
      category: "naked",
      engineCc: 649,
      powerKw: 35.0,
      wetWeightKg: 187.0,
      seatHeightMm: 790,
      priceBand: "mid",
    },
  },
];

const INTERVIEW_MESSAGES: ChatMessage[] = [
  {
    id: "01STUBMSG00000000000000001",
    role: "assistant",
    body:
      "Hello! I help people pick a motorcycle that actually fits them, using our " +
      "verified catalogue rather than marketing copy.\n\n" +
      "To start: **what licence do you hold**, and how much riding have you done so far?",
    ...emptyParts(),
    createdAt: OLDER_DAY.greeting,
  },
  {
    id: "01STUBMSG00000000000000002",
    role: "user",
    body:
      "A2 since last month, and before that two years on a 125.\n" +
      "I'm 1.65 m and I commute about 20 km a day.",
    ...emptyParts(),
    createdAt: OLDER_DAY.firstUser,
  },
  {
    id: "01STUBMSG00000000000000003",
    role: "assistant",
    body: `## What A2 means for your shortlist

Your licence caps a bike at **35 kW** and **0.2 kW/kg**, so we look at
mid-weight twins and restricted middleweights.

- seat height matters at 1.65 m — I will keep it under 800 mm
- 20 km a day means comfort and running costs count more than top speed
- a restricted 650 stays interesting after the two-year A2 period

| Class | Typical power | Typical wet weight |
| --- | --- | --- |
| A2 naked twin | 35 kW | 185–195 kg |
| Restricted middleweight | 35 kW (restricted) | 190–210 kg |
| A2 single | 20–25 kW | 150–165 kg |

What is your budget, and do you want something you keep after A2?`,
    toolCalls: [
      {
        id: "call-record-preference-height",
        tool: "record_preference",
        arguments: { attribute: "seat_height", value: "under 800 mm", firmness: "hard" },
        result: { attribute: "seat_height", value: "under 800 mm", firmness: "hard" },
        status: "succeeded",
        error: null,
      },
    ],
    sources: [],
    recommendations: [],
    createdAt: minutesAgo(42),
  },
  {
    id: "01STUBMSG00000000000000004",
    role: "user",
    body: "Around €7,000, and yes — I'd rather buy once. Is a Voge 500R any good?",
    ...emptyParts(),
    createdAt: minutesAgo(35),
  },
  {
    id: "01STUBMSG00000000000000005",
    role: "assistant",
    body: `Two bikes fit your budget, your height and your A2 licence, and both stay
enjoyable once the restriction lapses. The Voge is not in our catalogue yet, so
I have flagged it for research instead of guessing at its specs.`,
    toolCalls: KITCHEN_SINK_TOOL_CALLS,
    sources: KITCHEN_SINK_SOURCES,
    recommendations: KITCHEN_SINK_RECOMMENDATIONS,
    createdAt: minutesAgo(33),
  },
];

/**
 * The stub's mutable message table.
 *
 * `chat-typing` and `chat-stale` each end on a user message, because that is
 * what ui-spec §3.3 derives the "Seen" caption and the stale-turn row from; the
 * timestamps are computed per read (below) so "just now" stays just now however
 * long the dev server has been open.
 */
const stubMessages = new Map<string, ChatMessage[]>([
  [CHAT_IDS.interview, [...INTERVIEW_MESSAGES]],
  [
    CHAT_IDS.typing,
    [
      {
        id: "01STUBMSG00000000000000011",
        role: "assistant",
        body: "Welcome back! What would you like to look at today?",
        ...emptyParts(),
        createdAt: minutesAgo(3),
      },
      {
        id: "01STUBMSG00000000000000012",
        role: "user",
        body: "Compare the CB500F with the Z650 for a daily commute, please.",
        ...emptyParts(),
        createdAt: new Date().toISOString(),
      },
    ],
  ],
  [
    CHAT_IDS.stale,
    [
      {
        id: "01STUBMSG00000000000000021",
        role: "assistant",
        body: "Happy to help — tell me what you ride today.",
        ...emptyParts(),
        createdAt: minutesAgo(20),
      },
      {
        id: "01STUBMSG00000000000000022",
        role: "user",
        body: "I'm on a 125 and want something for weekend trips.",
        ...emptyParts(),
        createdAt: minutesAgo(6),
      },
    ],
  ],
  [CHAT_IDS.new, []],
  [CHAT_IDS.empty, []],
]);

/**
 * Which fixture chats have a simulated turn in flight, keyed chat id → operation
 * id. The chat resource's `activeOperationId` is read from here (`useChats.ts`
 * consults `stubActiveOperationId`) so that a single stub owns the whole turn
 * lifecycle: the timers that append a reply live in this module, and clearing
 * the pointer is the same map delete.
 */
const stubTurns = new Map<string, string>([
  [CHAT_IDS.typing, "01STUBOPERATIONTYPING00001"],
  [CHAT_IDS.stale, "01STUBOPERATIONSTALE000001"],
  [CHAT_IDS.new, "01STUBOPERATIONNEW00000001"],
]);

let stubOperationCounter = 0;

/**
 * The active operation id of a fixture chat, or `null`.
 *
 * Stub-only export: nothing but the sibling `useChats.ts` stub may import it,
 * and step 3.6 deletes both.
 */
export function stubActiveOperationId(chatId: string): string | null {
  return stubTurns.get(chatId) ?? null;
}

/**
 * The timestamps of `chat-typing`'s last user message and of `chat-stale`'s are
 * relative to *now*, not to module load: "just now" and "six minutes ago" are
 * the whole point of those two fixtures, and a dev server left open for an hour
 * would otherwise turn the typing fixture into the stale one.
 */
function withFreshTimestamps(chatId: string, rows: ChatMessage[]): ChatMessage[] {
  if (chatId !== CHAT_IDS.typing && chatId !== CHAT_IDS.stale) {
    return rows;
  }

  const lastIndex = rows.length - 1;

  return rows.map((row, index) =>
    index === lastIndex && row.role === "user"
      ? { ...row, createdAt: minutesAgo(chatId === CHAT_IDS.typing ? 0 : 6) }
      : row,
  );
}

function listMessages(chatId: string): Promise<ChatMessage[]> {
  const rows = stubMessages.get(chatId);

  if (rows === undefined) {
    // Same answer as the real endpoint for a foreign or unknown chat: no
    // existence leak, so the route shows its not-found gate.
    return Promise.reject(new ChatError(404, "not-found"));
  }

  return Promise.resolve(withFreshTimestamps(chatId, rows));
}

function appendMessage(chatId: string, message: ChatMessage): void {
  stubMessages.set(chatId, [...(stubMessages.get(chatId) ?? []), message]);
}

/** The advisor's stubbed answer to whatever was last said. */
function assistantReply(): ChatMessage {
  return {
    id: `01STUBREPLY${Date.now()}`.padEnd(26, "0").slice(0, 26),
    role: "assistant",
    body: `Understood — noted. Here is where that leaves us:

- your **A2 licence** keeps us under 35 kW
- a seat under 800 mm stays comfortable at your height

Anything else you want me to weigh in?`,
    ...emptyParts(),
    createdAt: new Date().toISOString(),
  };
}

/** The greeting the advisor opens a brand-new consultation with. */
function greetingMessage(): ChatMessage {
  return {
    id: `01STUBGREET${Date.now()}`.padEnd(26, "0").slice(0, 26),
    role: "assistant",
    body:
      "Hello! I'm your buying advisor. I ask a handful of questions and then " +
      "recommend motorcycles from our verified catalogue.\n\n" +
      "**What licence do you hold, and what do you want the bike for?**",
    ...emptyParts(),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Ends a simulated turn: the reply lands, the active-operation pointer clears
 * and both caches are dropped — exactly the two invalidations that
 * `chat.message.created` will trigger over SSE from step 3.6 on.
 */
function finishTurn(
  chatId: string,
  message: ChatMessage,
  queryClient: QueryClient,
): void {
  window.setTimeout(() => {
    appendMessage(chatId, message);
    stubTurns.delete(chatId);
    void queryClient.invalidateQueries({ queryKey: queryKeys.chatMessages.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
  }, STUB_REPLY_DELAY_MS);
}

/**
 * Starts the greeting turn of a freshly created consultation: the chat is
 * emptied, the pointer is set (so the view opens on the typing bubble) and the
 * advisor's greeting arrives a moment later, as the real `POST /api/chats` will.
 *
 * Stub-only export, as `stubActiveOperationId`.
 */
export function stubStartGreetingTurn(chatId: string, queryClient: QueryClient): void {
  stubOperationCounter += 1;
  stubMessages.set(chatId, []);
  stubTurns.set(chatId, `01STUBOPERATIONGREET${stubOperationCounter}`.padEnd(26, "0").slice(0, 26));
  finishTurn(chatId, greetingMessage(), queryClient);
}

/** Forgets a deleted chat's timeline, so a re-created id starts clean. */
export function stubForgetChat(chatId: string): void {
  stubMessages.delete(chatId);
  stubTurns.delete(chatId);
}

async function sendMessage(
  chatId: string,
  { body, localId }: { body: string; localId: string },
): Promise<ChatMessage> {
  await new Promise((resolve) => setTimeout(resolve, STUB_SEND_LATENCY_MS));

  if (body.trim().toLowerCase() === STUB_FAILING_BODY) {
    // The magic input of ui-spec §12: the failed-send bubble with its retry and
    // discard buttons is otherwise unreachable before the API exists.
    throw new ChatError(500);
  }

  if (!stubMessages.has(chatId)) {
    throw new ChatError(404, "not-found");
  }

  const created: ChatMessage = {
    // The server echoes the client's correlation id here, which is what lets a
    // refetch replace the optimistic entry instead of duplicating it.
    id: localId,
    role: "user",
    body,
    ...emptyParts(),
    createdAt: new Date().toISOString(),
  };

  appendMessage(chatId, created);
  stubOperationCounter += 1;
  stubTurns.set(chatId, `01STUBOPERATIONSEND${stubOperationCounter}`.padEnd(26, "0").slice(0, 26));

  return created;
}

// --- Hooks (contract; survives 3.6) ----------------------------------------

/**
 * One conversation's timeline, oldest → newest.
 *
 * The live version walks every page of
 * `GET /api/chat-messages?filter[chat]=…`; the order is the server's
 * (`createdAt ASC, id ASC`) and stays untouched, because the whole chat UI
 * reads "the last message" and "the newest user message" off the end of it.
 */
export function useChatMessages(chatId: string): UseQueryResult<ChatMessage[], Error> {
  return useQuery({
    queryKey: queryKeys.chatMessages.byChat(chatId),
    queryFn: () => listMessages(chatId),
    // The route param can be empty for a fraction of a render; asking for the
    // messages of chat "" would answer 404 and show the wrong gate.
    enabled: chatId !== "",
  });
}

/**
 * Sends the user's message — **the one optimistic update in this application**
 * (ui-spec §3.2).
 *
 * `onMutate` appends the outgoing message to the timeline cache immediately, so
 * the bubble is on screen before the request resolves; the caller clears the
 * composer and scrolls. On success the entry is marked `sent` (that *is* the
 * "seen" signal — there is no dedicated event) and both caches are invalidated,
 * so the refetch replaces it with the server row. On failure the entry stays put
 * marked `failed`: it holds the text the user typed, and the bubble offers retry
 * (same `localId`, so this replaces rather than duplicates) and discard.
 */
export function useSendMessage(
  chatId: string,
): UseMutationResult<ChatMessage, Error, { body: string; localId: string }> {
  const queryClient = useQueryClient();
  const timelineKey = queryKeys.chatMessages.byChat(chatId);

  function patchEntry(localId: string, patch: Partial<ChatMessage>): void {
    queryClient.setQueryData<ChatMessage[]>(timelineKey, (rows) =>
      rows?.map((row) => (row.localId === localId ? { ...row, ...patch } : row)),
    );
  }

  return useMutation<ChatMessage, Error, { body: string; localId: string }>({
    mutationFn: (input) => sendMessage(chatId, input),
    onMutate: ({ body, localId }) => {
      const optimistic: ChatMessage = {
        id: localId,
        role: "user",
        body,
        ...emptyParts(),
        createdAt: new Date().toISOString(),
        localId,
        state: "sending",
      };

      queryClient.setQueryData<ChatMessage[]>(timelineKey, (rows) => {
        const existing = rows ?? [];

        // A retry re-fires the mutation with the same `localId`: the failed
        // bubble must flip back to "sending" in place, not appear twice.
        return existing.some((row) => row.localId === localId)
          ? existing.map((row) => (row.localId === localId ? optimistic : row))
          : [...existing, optimistic];
      });
    },
    onSuccess: (_created, { localId }) => {
      patchEntry(localId, { state: "sent" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatMessages.all });
      // The chat's last activity and its `activeOperationId` both moved.
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });

      // Stub only: the advisor answers by itself so the whole rhythm — seen,
      // typing, completed message — is walkable before step 3.5/3.6 exist.
      finishTurn(chatId, assistantReply(), queryClient);
    },
    onError: (_error, { localId }) => {
      patchEntry(localId, { state: "failed" });
    },
  });
}
