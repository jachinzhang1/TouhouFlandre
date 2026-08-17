import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatDock } from "./ChatDock";
import {
  chatEntryFromMessage,
  initialRoomChatState,
  type RoomChatEntry,
  type RoomChatState,
} from "../../domain/multiChat";

const viewer = {
  memberId: "member-self",
  role: "player" as const,
  seat: 1,
  displayName: "自机",
  status: "connected" as const,
};

const baseChat: RoomChatState = {
  ...initialRoomChatState,
  historyStatus: "ready",
};

const message = (
  overrides: Partial<Parameters<typeof chatEntryFromMessage>[0]> = {},
): RoomChatEntry =>
  chatEntryFromMessage({
    messageId: "m000000000000000000000001",
    roomId: "room-1",
    senderMemberId: "member-2",
    senderDisplayName: "灵梦",
    senderRole: "player",
    senderSeat: 2,
    kind: "text",
    content: "hello",
    channel: "room",
    cursor: "cursor-1",
    createdAt: "2026-08-14T12:00:00Z",
    ...overrides,
  });

const dockElement = (chat: RoomChatState, props = {}) => (
  <ChatDock
    roomId="room-1"
    viewer={viewer}
    chat={chat}
    onSend={vi.fn().mockResolvedValue(true)}
    onRetry={vi.fn().mockResolvedValue(undefined)}
    onLoadOlder={vi.fn().mockResolvedValue(undefined)}
    onClearError={vi.fn()}
    {...props}
  />
);

const renderDock = (chat: RoomChatState, props = {}) =>
  render(dockElement(chat, props));

describe("ChatDock", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("uses one Paper button group for the inline page-bottom composer", () => {
    const { container } = renderDock(baseChat, { inline: true });
    const group = screen.getByRole("group", { name: "房间聊天" });
    expect(group.classList.contains("paper-segment-group")).toBe(true);
    expect(group.classList.contains("chat-dock-composer-group")).toBe(true);
    expect(group.querySelectorAll(".paper-segment-separator")).toHaveLength(2);
    expect(
      screen
        .getByLabelText("展开聊天记录")
        .classList.contains("paper-segment-button"),
    ).toBe(true);
    const chatToggle = screen.getByLabelText("关闭聊天");
    expect(chatToggle.classList.contains("paper-segment-button")).toBe(true);
    expect(chatToggle.getAttribute("aria-pressed")).toBe("true");
    expect(chatToggle.dataset.paperVariant).toBe("tinted");
    expect(
      chatToggle.querySelector(".lucide-message-circle-check"),
    ).toBeTruthy();
    expect(
      screen
        .getByLabelText("聊天输入")
        .closest(".chat-dock-input-segment.paper-surface"),
    ).toBeTruthy();
    expect(container.querySelector(".chat-dock-inline")).toBeTruthy();
  });

  it("renders player labels with P number and spectator labels without one", async () => {
    const user = userEvent.setup();
    renderDock({
      ...baseChat,
      messages: [
        message({ content: "<img src=x onerror=alert(1)>" }),
        message({
          messageId: "m000000000000000000000002",
          senderMemberId: "spectator-1",
          senderDisplayName: "观战者",
          senderRole: "spectator",
          senderSeat: undefined,
          channel: "spectator",
          content: "只给观战席",
          cursor: "cursor-2",
        }),
      ],
    });

    await user.click(screen.getByLabelText("展开聊天记录"));

    const playerName = screen.getByText("灵梦");
    const playerSeat = screen.getByText("P2");
    expect(playerName.tagName).toBe("STRONG");
    expect(playerSeat.classList.contains("chat-player-seat-tag")).toBe(true);
    expect(screen.queryByText("(P2)")).toBeNull();
    expect(screen.getByText("观战者")).not.toBeNull();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).not.toBeNull();
    const history = screen.getByRole("log");
    expect(
      history.closest(".chat-dock-history-paper.paper-surface"),
    ).toBeTruthy();
    expect(history.querySelector(".chat-dock-history-list")).toBeTruthy();
    expect(
      history.querySelectorAll(".chat-dock-history-list > li"),
    ).toHaveLength(2);
  });

  it("inserts a whitelisted emoji and sends on Enter", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(true);
    renderDock(baseChat, { onSend });

    await user.click(screen.getByLabelText("选择表情"));
    await user.click(screen.getByText("🌸"));
    const input = screen.getByLabelText("聊天输入");
    expect((input as HTMLInputElement).value).toBe("🌸");
    expect(document.activeElement).toBe(input);
    expect((input as HTMLInputElement).placeholder).toBe("请输入消息");

    await user.keyboard("{Enter}");

    expect(onSend).toHaveBeenCalledWith("🌸");
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("disables history, input, and emoji controls while muted", async () => {
    const user = userEvent.setup();
    renderDock(baseChat);

    await user.click(screen.getByLabelText("关闭聊天"));

    expect(
      (screen.getByLabelText("展开聊天记录") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("聊天输入") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (
        screen
          .getByLabelText("聊天输入")
          .closest(".chat-dock-input-segment") as HTMLElement | null
      )?.dataset.paperDisabled,
    ).toBe("true");
    expect(
      (screen.getByLabelText("选择表情") as HTMLButtonElement).disabled,
    ).toBe(true);
    const enableChat = screen.getByLabelText("开启聊天");
    expect(enableChat.getAttribute("aria-pressed")).toBe("false");
    expect(enableChat.dataset.paperVariant).toBe("plain");
    expect(enableChat.querySelector(".lucide-message-circle-off")).toBeTruthy();
  });

  it("disables only sending controls when the viewer is not connected", () => {
    renderDock(baseChat, {
      viewer: { ...viewer, status: "disconnected" as const },
    });

    expect(
      (screen.getByLabelText("展开聊天记录") as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByLabelText("聊天输入") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("选择表情") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("keeps history available when chat sending is disabled by rollout", () => {
    renderDock(baseChat, { sendEnabled: false });

    expect(
      (screen.getByLabelText("展开聊天记录") as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByLabelText("聊天输入") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("选择表情") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("renders history as plain rows and colors the current sender label", async () => {
    const user = userEvent.setup();
    renderDock({
      ...baseChat,
      messages: [
        message({
          senderMemberId: "member-self",
          senderDisplayName: "自机",
          senderSeat: 1,
          content: "mine",
        }),
      ],
    });

    await user.click(screen.getByLabelText("展开聊天记录"));

    const label = screen.getByText("自机");
    const seat = screen.getByText("P1");
    expect(label.tagName).toBe("STRONG");
    expect(label.className).toContain("text-vermilion");
    expect(seat.classList.contains("chat-player-seat-tag")).toBe(true);
    expect(label.closest("li")).not.toBeNull();
    expect(label.closest("li")?.className).not.toContain("rounded");
  });

  it("does not replay messages received while muted after unmuting", async () => {
    const user = userEvent.setup();
    const { rerender } = renderDock(baseChat);

    await user.click(screen.getByLabelText("关闭聊天"));
    rerender(
      dockElement({
        ...baseChat,
        messages: [message()],
      }),
    );
    expect(screen.queryByRole("status")).toBeNull();

    await user.click(screen.getByLabelText("开启聊天"));
    expect(screen.queryByRole("status")).toBeNull();

    rerender(
      dockElement({
        ...baseChat,
        messages: [
          message(),
          message({
            messageId: "m000000000000000000000002",
            content: "fresh",
            cursor: "cursor-2",
            createdAt: "2026-08-14T12:00:01Z",
          }),
        ],
      }),
    );
    expect(screen.getByRole("status").textContent).toContain("灵梦P2: fresh");
  });

  it("shows a floating card for a new received message and fades it out", () => {
    vi.useFakeTimers();
    const { rerender } = renderDock(baseChat);

    rerender(
      <ChatDock
        roomId="room-1"
        viewer={viewer}
        chat={{ ...baseChat, messages: [message()] }}
        onSend={vi.fn().mockResolvedValue(true)}
        onRetry={vi.fn().mockResolvedValue(undefined)}
        onLoadOlder={vi.fn().mockResolvedValue(undefined)}
        onClearError={vi.fn()}
      />,
    );

    expect(screen.getByRole("status").textContent).toContain("灵梦P2: hello");

    fireEvent.mouseEnter(screen.getByRole("status"));
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.getByRole("status")).not.toBeNull();

    fireEvent.mouseLeave(screen.getByRole("status"));
    act(() => vi.advanceTimersByTime(5300));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
