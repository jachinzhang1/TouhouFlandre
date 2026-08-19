import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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

const failedMessage: RoomChatEntry = {
  messageId: "pending:failed-message",
  roomId: "room-1",
  senderMemberId: viewer.memberId,
  senderDisplayName: viewer.displayName,
  senderRole: "player",
  senderSeat: 1,
  kind: "text",
  content: "这条消息没有送达",
  channel: "room",
  createdAt: "2026-08-14T12:00:02Z",
  deliveryStatus: "failed",
  clientMessageId: "failed-client-message",
  error: "网络连接中断",
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

  it("separates standalone chat controls from the message editor group", () => {
    const { container } = renderDock(baseChat, { placement: "inline" });
    const form = screen.getByRole("form", { name: "房间聊天" });
    const group = screen.getByRole("group", { name: "消息编辑" });
    expect(form.classList.contains("chat-dock-form")).toBe(true);
    expect(group.classList.contains("paper-segment-group")).toBe(true);
    expect(group.classList.contains("chat-dock-composer-group")).toBe(true);
    expect(group.querySelectorAll(".paper-segment-separator")).toHaveLength(2);

    const history = screen.getByLabelText("展开聊天记录");
    expect(history.classList.contains("paper-button")).toBe(true);
    expect(group.contains(history)).toBe(false);

    const emoji = screen.getByLabelText("选择表情");
    expect(emoji.classList.contains("paper-button")).toBe(true);
    expect(emoji.dataset.paperVariant).toBe("plain");
    expect(group.contains(emoji)).toBe(true);

    const send = screen.getByLabelText("发送消息");
    expect(send.classList.contains("paper-button")).toBe(true);
    expect(group.contains(send)).toBe(true);

    const chatToggle = screen.getByLabelText("关闭聊天");
    expect(chatToggle.classList.contains("paper-button")).toBe(true);
    expect(chatToggle.getAttribute("aria-pressed")).toBe("true");
    expect(chatToggle.dataset.paperVariant).toBe("plain");
    expect(chatToggle.dataset.paperFolded).toBe("false");
    expect(group.contains(chatToggle)).toBe(false);
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

  it("labels deck chat as a secondary command channel", async () => {
    const user = userEvent.setup();
    renderDock(baseChat, { placement: "deck" });

    expect(screen.getByText("聊天", { selector: "strong" })).toBeTruthy();
    expect(screen.getByText("房间消息")).toBeTruthy();
    expect(screen.getByRole("form", { name: "聊天" })).toBeTruthy();
    await user.type(screen.getByLabelText("聊天输入"), "开局吧");
    const send = screen.getByLabelText("发送消息");
    expect(send.dataset.paperTone).toBe("neutral");
    expect(send.dataset.paperVariant).toBe("tinted");
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

  it("inserts a whitelisted emoji and sends by button or Enter", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(true);
    renderDock(baseChat, { onSend });

    await user.click(screen.getByLabelText("选择表情"));
    await user.click(screen.getByText("🌸"));
    const input = screen.getByLabelText("聊天输入");
    expect((input as HTMLInputElement).value).toBe("🌸");
    expect(document.activeElement).toBe(input);
    expect((input as HTMLInputElement).placeholder).toBe("请输入消息");
    const send = screen.getByLabelText("发送消息");
    expect(send.dataset.paperVariant).toBe("tinted");
    expect(send.dataset.paperFolded).toBe("true");

    await user.click(send);

    expect(onSend).toHaveBeenCalledWith("🌸");
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));

    await user.type(input, "再来一条{Enter}");
    expect(onSend).toHaveBeenLastCalledWith("再来一条");
  });

  it("offers failed-message retry without opening chat history", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn().mockResolvedValue(undefined);
    renderDock(
      {
        ...baseChat,
        messages: [failedMessage],
        sendError: "网络连接中断",
      },
      { onRetry },
    );

    const recovery = screen.getByRole("alert");
    expect(recovery.textContent).toContain("消息未送达");
    expect(recovery.textContent).toContain("这条消息没有送达");
    expect(recovery.textContent).toContain("网络连接中断");
    expect(screen.queryByRole("log")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "重试发送第 1 条失败消息" }),
    );
    expect(onRetry).toHaveBeenCalledWith("failed-client-message");

    await user.click(screen.getByLabelText("展开聊天记录"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
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
    expect(
      (screen.getByLabelText("发送消息") as HTMLButtonElement).disabled,
    ).toBe(true);
    const enableChat = screen.getByLabelText("开启聊天");
    expect(enableChat.getAttribute("aria-pressed")).toBe("false");
    expect(enableChat.dataset.paperVariant).toBe("plain");
    expect(enableChat.querySelector(".lucide-message-circle-off")).toBeTruthy();

    await user.click(enableChat);
    const input = screen.getByLabelText("聊天输入") as HTMLInputElement;
    expect(input.disabled).toBe(false);
    expect(
      (screen.getByLabelText("选择表情") as HTMLButtonElement).disabled,
    ).toBe(false);
    await user.type(input, "恢复聊天");
    expect(
      (screen.getByLabelText("发送消息") as HTMLButtonElement).disabled,
    ).toBe(false);
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
    expect(
      (screen.getByLabelText("发送消息") as HTMLButtonElement).disabled,
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
