import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { queryKeys } from "../queryKeys";

import {
  ChatError,
  stubActiveOperationId,
  stubForgetChat,
  stubStartGreetingTurn,
} from "./useChatMessages";

/**
 * STUB — the whole file is replaced wholesale in step 3.6, when the `chats`
 * endpoints reach the generated API client. The exported names, the argument
 * shapes and the query keys are pinned by
 * `docs/roadmap/phase-3/shared-knowledge.md` (§Frontend conventions — delta);
 * do not change them, and do not import anything from here that 3.6 will not
 * still export.
 *
 * What is real here: the TanStack Query plumbing. The hooks return genuine
 * `useQuery`/`useMutation` results over an in-memory fixture table, keyed and
 * invalidated exactly as the live versions will be, so the components written
 * against them survive the replacement without edits. Only the "stub server"
 * section goes away in 3.6.
 *
 * `ChatError` is re-exported by the sibling `useChatMessages.ts` (pinned there);
 * the three `stub*` helpers imported above are the fixture conversations' turn
 * lifecycle, which lives next to the timers that drive it.
 */

// --- Contract types (survive 3.6) ------------------------------------------

/**
 * One consultation, as the `chats` resource delivers it (id merged with its
 * attributes — no component ever touches a JSON:API envelope).
 *
 * `activeOperationId` is the **only** source of the "advisor is replying" state:
 * `/api/operations` is admin-only and the customer UI never reads it.
 * `updatedAt` doubles as last activity — the server bumps it on every appended
 * message and sorts the list by it, descending. There is no status column.
 */
export interface Chat {
  id: string;
  title: string | null;
  activeOperationId: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- Stub server (deleted in 3.6) ------------------------------------------

/** Fixture ids, 26 characters like the ULID primary keys they stand in for. */
const FIXTURE_IDS = {
  interview: "01STUBCHATINTERVIEW0000000",
  typing: "01STUBCHATTYPING0000000000",
  stale: "01STUBCHATSTALE00000000000",
  new: "01STUBCHATNEW0000000000000",
  empty: "01STUBCHATEMPTY00000000000",
} as const;

/** Round trip long enough to make the pending states observable in the UI. */
const STUB_LATENCY_MS = 500;

/**
 * The five consultations of ui-spec §12, newest activity first — one per state
 * the list and the chat view can be in: a finished interview, a turn in flight,
 * a turn that went stale, a just-created chat waiting for its greeting, and an
 * untitled idle one (the rare intro state). `activeOperationId` is not stored
 * here: it is derived from the sibling stub's turn table, so the timers that end
 * a turn also clear the pointer.
 */
const FIXTURE_CHATS: readonly Omit<Chat, "activeOperationId">[] = [
  {
    id: FIXTURE_IDS.new,
    title: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: FIXTURE_IDS.typing,
    title: "First big bike after the A2",
    createdAt: "2026-08-26T07:40:00Z",
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
  },
  {
    id: FIXTURE_IDS.stale,
    title: "Weekend trips on a budget",
    createdAt: "2026-08-26T18:05:00Z",
    updatedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
  },
  {
    id: FIXTURE_IDS.interview,
    title: "Commuter bike for the city",
    createdAt: "2026-08-25T09:01:00Z",
    updatedAt: new Date(Date.now() - 33 * 60_000).toISOString(),
  },
  {
    id: FIXTURE_IDS.empty,
    title: null,
    createdAt: "2026-08-20T09:15:00Z",
    updatedAt: "2026-08-20T09:15:00Z",
  },
];

/**
 * The stub's mutable table. Creating and deleting write to it so the list query
 * refetches into visibly different data — without that, "Ask the advisor" and
 * the delete dialog would look broken to anyone clicking through the screen
 * before 3.6.
 */
let stubChats: Omit<Chat, "activeOperationId">[] = [...FIXTURE_CHATS];

function stubLatency(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, STUB_LATENCY_MS);
  });
}

/** Adds the derived turn pointer to a stored row. */
function toChat(row: Omit<Chat, "activeOperationId">): Chat {
  return { ...row, activeOperationId: stubActiveOperationId(row.id) };
}

function listChats(): Promise<Chat[]> {
  // The endpoint's pinned sort is `-updatedAt` (last activity first).
  return Promise.resolve(
    [...stubChats]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(toChat),
  );
}

function getChat(chatId: string): Promise<Chat> {
  const row = stubChats.find((chat) => chat.id === chatId);

  if (row === undefined) {
    // Unknown id and foreign owner answer the same 404 — no existence leak.
    return Promise.reject(new ChatError(404, "not-found"));
  }

  return Promise.resolve(toChat(row));
}

async function createChat(): Promise<Chat> {
  await stubLatency();

  // Always the same fixture chat, reset to its just-created shape: ui-spec §12
  // pins `chat-new` as the destination of the create stub, and resetting makes
  // the advisor-speaks-first arrival repeatable.
  const created: Omit<Chat, "activeOperationId"> = {
    id: FIXTURE_IDS.new,
    title: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  stubChats = [created, ...stubChats.filter((chat) => chat.id !== created.id)];

  // The greeting turn is started in the hook's `onSuccess`, which is where the
  // query client driving the stub's timers is available; the chat detail the
  // view then fetches carries the pointer, exactly as the real 201 does.
  return toChat(created);
}

async function deleteChat(chatId: string): Promise<void> {
  await stubLatency();

  if (!stubChats.some((chat) => chat.id === chatId)) {
    // A 404 counts as success for the real hook (the row is gone either way),
    // so the stub does not reject here.
    return;
  }

  stubChats = stubChats.filter((chat) => chat.id !== chatId);
  stubForgetChat(chatId);
}

// --- Hooks (contract; survives 3.6) ----------------------------------------

/**
 * The signed-in user's consultations, last activity first.
 *
 * Owner scoping is server-side; the live version walks the pages of
 * `GET /api/chats` via `meta.totalCount`.
 */
export function useChats(): UseQueryResult<Chat[], Error> {
  return useQuery({
    queryKey: queryKeys.chats.list(),
    queryFn: listChats,
  });
}

/**
 * One consultation — the resource that carries `activeOperationId`, i.e. the
 * input the chat view derives its turn state from (ui-spec §3.3).
 */
export function useChat(chatId: string): UseQueryResult<Chat, Error> {
  return useQuery({
    queryKey: queryKeys.chats.detail(chatId),
    queryFn: () => getChat(chatId),
    // The route param can be empty for a fraction of a render; asking for chat
    // "" would answer 404 and show the wrong gate.
    enabled: chatId !== "",
  });
}

/**
 * Starts a consultation (`POST /api/chats`, empty body).
 *
 * A chat is only ever created by the explicit "Ask the advisor" button, never on
 * page load, and the response already carries `activeOperationId` set: the
 * advisor opens the conversation with a greeting and the first interview
 * question, so the chat view lands directly in the typing state. Navigating to
 * the new chat belongs to the route, which owns the URL.
 */
export function useCreateChat(): UseMutationResult<Chat, Error, void> {
  const queryClient = useQueryClient();

  return useMutation<Chat, Error, void>({
    mutationFn: createChat,
    onSuccess: (created) => {
      // Stub only: the greeting turn (pointer set, message ~1.5 s later) is what
      // `start_response` does server-side from step 3.5 on.
      stubStartGreetingTurn(created.id, queryClient);
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
    },
  });
}

/**
 * Deletes a consultation (`DELETE /api/chats/{id}` — a soft delete server-side).
 *
 * There is no restore affordance: the row is kept in the database, but bringing
 * it back is not a UI feature. The confirmation dialog lives in the list route.
 */
export function useDeleteChat(): UseMutationResult<void, Error, { chatId: string }> {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { chatId: string }>({
    mutationFn: ({ chatId }) => deleteChat(chatId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
    },
  });
}
