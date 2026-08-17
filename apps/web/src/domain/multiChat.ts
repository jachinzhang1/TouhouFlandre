import type {
  ChatMessageFrame,
  MultiParticipantRole,
} from "@touhouflandre/shared";
import type { components } from "../generated/api";

export const CHAT_EMOJI_WHITELIST = [
  "😀",
  "😂",
  "😍",
  "🤔",
  "😭",
  "😡",
  "👍",
  "👎",
  "🎉",
  "❤️",
  "✨",
  "🌸",
] as const;

export type ChatMessage = components["schemas"]["ChatMessage"];
export type ChatHistoryResponse = components["schemas"]["ChatHistoryResponse"];
export type ChatKind = components["schemas"]["ChatKind"];
export type ChatChannel = components["schemas"]["ChatChannel"];

export type ChatDeliveryStatus = "sending" | "sent" | "failed";
export type ChatHistoryStatus = "idle" | "loading" | "ready" | "error";

export interface RoomChatEntry {
  messageId: string;
  roomId: string;
  senderMemberId: string;
  senderDisplayName: string;
  senderRole: MultiParticipantRole;
  senderSeat?: number;
  kind: ChatKind;
  content: string;
  channel?: ChatChannel;
  cursor?: string;
  createdAt: string;
  deliveryStatus: ChatDeliveryStatus;
  clientMessageId?: string;
  error?: string;
}

export interface RoomChatState {
  messages: RoomChatEntry[];
  scannedCursor: string | null;
  beforeCursor: string | null;
  hasMoreOlder: boolean;
  historyStatus: ChatHistoryStatus;
  historyError: string | null;
  loadingOlder: boolean;
  sendError: string | null;
}

export const initialRoomChatState: RoomChatState = {
  messages: [],
  scannedCursor: null,
  beforeCursor: null,
  hasMoreOlder: false,
  historyStatus: "idle",
  historyError: null,
  loadingOlder: false,
  sendError: null,
};

export function normalizeChatDraft(
  draft: string,
): { kind: ChatKind; content: string } | null {
  const content = draft.replace(/\r\n?/g, "\n").normalize("NFC").trim();
  if (!content) return null;
  if (
    CHAT_EMOJI_WHITELIST.includes(
      content as (typeof CHAT_EMOJI_WHITELIST)[number],
    )
  ) {
    return { kind: "emoji", content };
  }
  return { kind: "text", content };
}

export function isChatFrame(value: unknown): value is ChatMessageFrame {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "chat.message" &&
    typeof (value as { messageId?: unknown }).messageId === "string" &&
    typeof (value as { cursor?: unknown }).cursor === "string"
  );
}

export function chatEntryFromMessage(message: ChatMessage): RoomChatEntry {
  return {
    ...message,
    senderRole: message.senderRole,
    deliveryStatus: "sent",
  };
}

export function chatEntryFromFrame(frame: ChatMessageFrame): RoomChatEntry {
  return {
    messageId: frame.messageId,
    roomId: frame.roomId,
    senderMemberId: frame.senderMemberId,
    senderDisplayName: frame.senderDisplayName,
    senderRole: frame.senderRole,
    senderSeat: frame.senderSeat,
    kind: frame.kind,
    content: frame.content,
    channel: frame.channel,
    cursor: frame.cursor,
    createdAt: frame.createdAt,
    deliveryStatus: "sent",
  };
}

export function pendingChatEntry({
  clientMessageId,
  roomId,
  viewer,
  kind,
  content,
}: {
  clientMessageId: string;
  roomId: string;
  viewer: {
    memberId: string;
    role: MultiParticipantRole;
    seat?: number;
    displayName: string;
  };
  kind: ChatKind;
  content: string;
}): RoomChatEntry {
  return {
    messageId: `pending:${clientMessageId}`,
    roomId,
    senderMemberId: viewer.memberId,
    senderDisplayName: viewer.displayName,
    senderRole: viewer.role,
    senderSeat: viewer.seat,
    kind,
    content,
    channel: viewer.role === "player" ? "room" : "spectator",
    createdAt: new Date().toISOString(),
    deliveryStatus: "sending",
    clientMessageId,
  };
}

export function chatStateWithInitialHistory(
  response: ChatHistoryResponse,
): RoomChatState {
  return {
    ...initialRoomChatState,
    messages: response.messages.map(chatEntryFromMessage),
    scannedCursor: response.scannedCursor ?? null,
    beforeCursor: response.beforeCursor ?? null,
    hasMoreOlder: response.hasMore,
    historyStatus: "ready",
  };
}

export function chatStateWithHistoryError(error: string): RoomChatState {
  return {
    ...initialRoomChatState,
    historyStatus: "error",
    historyError: error,
  };
}

export function mergeChatEntries(
  state: RoomChatState,
  entries: RoomChatEntry[],
): RoomChatState {
  const merged = new Map<string, RoomChatEntry>();
  for (const message of state.messages)
    merged.set(chatEntryKey(message), message);
  for (const entry of entries) merged.set(chatEntryKey(entry), entry);
  return {
    ...state,
    messages: sortChatEntries([...merged.values()]),
  };
}

export function mergeOlderChatHistory(
  state: RoomChatState,
  response: ChatHistoryResponse,
): RoomChatState {
  return {
    ...mergeChatEntries(state, response.messages.map(chatEntryFromMessage)),
    beforeCursor: response.beforeCursor ?? null,
    hasMoreOlder: response.hasMore,
    loadingOlder: false,
    historyError: null,
  };
}

export function confirmPendingChatEntry(
  state: RoomChatState,
  clientMessageId: string,
  message: ChatMessage,
): RoomChatState {
  const confirmed = chatEntryFromMessage(message);
  return mergeChatEntries(
    {
      ...state,
      messages: state.messages.filter(
        (entry) => entry.clientMessageId !== clientMessageId,
      ),
      scannedCursor: message.cursor,
      sendError: null,
    },
    [confirmed],
  );
}

export function failPendingChatEntry(
  state: RoomChatState,
  clientMessageId: string,
  error: string,
): RoomChatState {
  return {
    ...state,
    sendError: error,
    messages: state.messages.map((entry) =>
      entry.clientMessageId === clientMessageId
        ? { ...entry, deliveryStatus: "failed", error }
        : entry,
    ),
  };
}

export function advanceChatCursor(
  state: RoomChatState,
  cursor: string,
): RoomChatState {
  return {
    ...state,
    scannedCursor: cursor,
  };
}

export function isOwnChatEntry(
  entry: RoomChatEntry,
  viewerMemberId: string | null | undefined,
): boolean {
  return Boolean(viewerMemberId && entry.senderMemberId === viewerMemberId);
}

function chatEntryKey(entry: RoomChatEntry): string {
  if (entry.messageId.startsWith("pending:")) return entry.messageId;
  return `server:${entry.roomId}:${entry.messageId}`;
}

function sortChatEntries(entries: RoomChatEntry[]): RoomChatEntry[] {
  return [...entries].sort((a, b) => {
    const aTime = Date.parse(a.createdAt);
    const bTime = Date.parse(b.createdAt);
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
      return aTime - bTime;
    }
    return a.messageId.localeCompare(b.messageId);
  });
}
