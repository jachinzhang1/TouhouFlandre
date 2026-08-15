import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRoom } from "./useRoom";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      roomSnapshot: vi.fn(),
      listRoomMessages: vi.fn(),
    },
  };
});

import { api } from "../lib/api";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  close = vi.fn(() => this.onclose?.({} as CloseEvent));
  send = vi.fn();

  constructor() {
    MockWebSocket.instances.push(this);
  }

  receive(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent);
  }
}

const snapshot = (role: "player" | "spectator") => ({
  roomId: "room-1",
  roomCode: "ABC234",
  format: "bo3",
  mode: "race",
  turnSeconds: 60,
  playerLimit: 4,
  minPlayers: 2,
  playerCount: role === "player" ? 2 : 1,
  availableSeats: role === "player" ? 2 : 3,
  status: "lobby",
  expiresAt: "2026-08-13T12:30:00Z",
  viewer: {
    memberId: "viewer",
    role,
    ...(role === "player" ? { seat: 2 } : {}),
    displayName: "Viewer",
    status: "connected",
  },
  members: [
    {
      memberId: "host",
      seat: 1,
      displayName: "Host",
      status: "connected",
      ready: false,
    },
    ...(role === "player"
      ? [
          {
            memberId: "viewer",
            seat: 2,
            displayName: "Viewer",
            status: "connected",
            ready: false,
          },
        ]
      : []),
  ],
  spectatorCount: role === "spectator" ? 1 : 0,
  match: null,
  round: null,
  gameSequence: 0,
  events: [],
});

describe("useRoom replacement handling", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.mocked(api.roomSnapshot).mockReset();
    vi.mocked(api.listRoomMessages).mockReset();
    vi.mocked(api.listRoomMessages).mockResolvedValue({
      messages: [],
      hasMore: false,
      scannedCursor: "chat-cursor-0",
    } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stops reconnecting after ordinary replacement until explicitly requested", async () => {
    vi.mocked(api.roomSnapshot).mockResolvedValue(snapshot("player") as never);
    const { result, unmount } = renderHook(() => useRoom("room-1", "token"));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    act(() => MockWebSocket.instances[0].onopen?.({} as Event));
    expect(JSON.parse(MockWebSocket.instances[0].send.mock.calls[0][0])).toEqual(
      {
        type: "hello",
        token: "token",
        lastGameSequence: 0,
        lastChatCursor: "chat-cursor-0",
      },
    );

    act(() =>
      MockWebSocket.instances[0].receive({
        type: "replaced",
        reason: "replaced",
      }),
    );
    expect(result.current.state.connectionIssue).toMatch(/^其他页面已连接/);
    expect(MockWebSocket.instances).toHaveLength(1);

    act(() => result.current.actions.reconnect());
    expect(MockWebSocket.instances).toHaveLength(2);
    unmount();
  });

  it("clears the old role and automatically reconnects after member_changed", async () => {
    let resolveChanged: ((value: unknown) => void) | undefined;
    vi.mocked(api.roomSnapshot)
      .mockResolvedValueOnce(snapshot("spectator") as never)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveChanged = resolve;
          }) as never,
      );
    const { result, unmount } = renderHook(() => useRoom("room-1", "token"));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));

    act(() =>
      MockWebSocket.instances[0].receive({
        type: "replaced",
        reason: "member_changed",
      }),
    );
    expect(result.current.state.viewer).toBeNull();
    expect(result.current.state.connectionIssue).toMatch(/^身份已更新/);

    await act(async () => resolveChanged?.(snapshot("player")));
    await waitFor(() =>
      expect(result.current.state.viewer?.role).toBe("player"),
    );
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(vi.mocked(api.listRoomMessages)).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("applies chat.message frames without advancing the game sequence", async () => {
    vi.mocked(api.roomSnapshot).mockResolvedValue(snapshot("player") as never);
    const { result, unmount } = renderHook(() => useRoom("room-1", "token"));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));

    act(() => MockWebSocket.instances[0].onopen?.({} as Event));
    act(() =>
      MockWebSocket.instances[0].receive({
        type: "hello-ok",
        roomId: "room-1",
        targetGameSequence: 0,
        targetChatCursor: "chat-cursor-0",
      }),
    );
    act(() =>
      MockWebSocket.instances[0].receive({
        type: "sync.complete",
        gameSequence: 0,
        chatCursor: "chat-cursor-0",
      }),
    );
    act(() =>
      MockWebSocket.instances[0].receive({
        type: "chat.message",
        messageId: "m000000000000000000000001",
        roomId: "room-1",
        senderMemberId: "host",
        senderDisplayName: "Host",
        senderRole: "player",
        senderSeat: 1,
        kind: "text",
        content: "hello",
        channel: "room",
        cursor: "chat-cursor-1",
        createdAt: "2026-08-14T12:00:00Z",
      }),
    );

    expect(result.current.state.appliedGameSequence).toBe(0);
    expect(result.current.state.chat.scannedCursor).toBe("chat-cursor-1");
    expect(result.current.state.chat.messages).toHaveLength(1);
    expect(result.current.state.chat.messages[0].content).toBe("hello");
    unmount();
  });
});
