import { describe, expect, it } from "vitest";
import {
  chatEntryFromMessage,
  initialRoomChatState,
  mergeChatEntries,
  normalizeChatDraft,
} from "./multiChat";

const message = (overrides: Partial<ReturnType<typeof chatEntryFromMessage>>) =>
  chatEntryFromMessage({
    messageId: "m000000000000000000000001",
    roomId: "room-1",
    senderMemberId: "member-1",
    senderDisplayName: "灵梦",
    senderRole: "player",
    senderSeat: 1,
    kind: "text",
    content: "hello",
    channel: "room",
    cursor: "cursor-1",
    createdAt: "2026-08-14T12:00:00Z",
    ...overrides,
  });

describe("multiChat domain helpers", () => {
  it("treats a single whitelisted emoji as emoji and mixed text as text", () => {
    expect(normalizeChatDraft(" 🌸 ")).toEqual({
      kind: "emoji",
      content: "🌸",
    });
    expect(normalizeChatDraft("🌸 好耶")).toEqual({
      kind: "text",
      content: "🌸 好耶",
    });
    expect(normalizeChatDraft("   ")).toBeNull();
  });

  it("deduplicates server messages by messageId", () => {
    const first = message({ content: "first" });
    const duplicate = message({ content: "updated by server" });
    const state = mergeChatEntries(initialRoomChatState, [first, duplicate]);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].content).toBe("updated by server");
  });
});
