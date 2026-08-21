import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../../lib/api";
import { RoomLobby } from "./RoomLobby";

const members = [
  {
    memberId: "host",
    seat: 1,
    displayName: "Host",
    status: "connected" as const,
    ready: false,
  },
  {
    memberId: "guest",
    seat: 3,
    displayName: "Guest",
    status: "connected" as const,
    ready: false,
  },
];

const renderLobby = (
  overrides: Partial<React.ComponentProps<typeof RoomLobby>> = {},
) => {
  const props: React.ComponentProps<typeof RoomLobby> = {
    roomCode: "ABC234",
    format: "bo3",
    mode: "race",
    turnSeconds: 60,
    members,
    mySlot: 3,
    viewerMemberId: "guest",
    viewerRole: "player",
    playerLimit: 4,
    minPlayers: 2,
    playerCount: 2,
    availableSeats: 2,
    spectatorCount: 1,
    isHost: false,
    onReady: vi.fn(),
    onLeave: vi.fn(),
    ...overrides,
  };
  render(<RoomLobby {...props} />);
  return props;
};

describe("RoomLobby", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("groups invitation, member ledger, progression, and exit by hierarchy", () => {
    renderLobby();
    const container = document.body;

    expect(screen.getByRole("heading", { name: "等待开局" })).toBeTruthy();
    const share = container.querySelector(
      ".room-lobby-share.paper-surface",
    ) as HTMLElement;
    expect(share).toBeTruthy();
    expect(within(share).getByText("邀请好友加入")).toBeTruthy();
    expect(
      within(share).getByText("ABC234", { selector: "code" }),
    ).toBeTruthy();
    const copy = within(share).getByRole("button", { name: "复制房间号" });
    expect(copy.classList.contains("paper-button-theme")).toBe(true);
    expect(container.querySelector(".page-header-slot-right")).toBeNull();

    const ledger = screen.getByRole("table", { name: /房间玩家 2\/4/ });
    expect(within(ledger).getAllByRole("columnheader")).toHaveLength(4);
    expect(within(ledger).getByText("房主")).toBeTruthy();
    expect(within(ledger).getByText("我")).toBeTruthy();
    expect(within(ledger).getAllByText("在线")).toHaveLength(2);
    expect(within(ledger).getAllByText("未准备")).toHaveLength(2);
    expect(container.querySelector(".room-lobby-empty-seat")).toBeNull();

    const progression = container.querySelector(
      ".room-lobby-progression.paper-surface",
    ) as HTMLElement;
    expect(within(progression).getByText("准备开局")).toBeTruthy();
    expect(within(progression).getByText(/至少 2 名玩家/)).toBeTruthy();
    const leave = screen.getByRole("button", { name: "离开房间" });
    expect(leave.classList.contains("paper-button-danger")).toBe(true);
    expect(progression.contains(leave)).toBe(false);
  });

  it("uses memberId for self and exposes readiness as a toggle", () => {
    const props = renderLobby();
    const ready = screen.getByRole("button", { name: "我准备好了" });
    expect(ready.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(ready);
    expect(props.onReady).toHaveBeenCalledWith(true);
  });

  it("allows a ready player to cancel with secondary treatment", () => {
    const onReady = vi.fn();
    renderLobby({
      members: members.map((member) =>
        member.memberId === "guest" ? { ...member, ready: true } : member,
      ),
      onReady,
    });
    const cancel = screen.getByRole("button", { name: "取消准备" });
    expect(cancel.getAttribute("aria-pressed")).toBe("true");
    expect(cancel.dataset.paperVariant).toBe("plain");
    fireEvent.click(cancel);
    expect(onReady).toHaveBeenCalledWith(false);
  });

  it("hides the player limit setting while rollout is closed", () => {
    vi.stubEnv("NEXT_PUBLIC_MULTI_N_PLAYER_RACE_ENABLED", "false");
    renderLobby({
      isHost: true,
      mySlot: 1,
      viewerMemberId: "host",
    });
    expect(screen.queryByRole("slider", { name: "玩家上限" })).toBeNull();
  });

  it("lets the host explicitly apply a changed player limit", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    renderLobby({
      isHost: true,
      mySlot: 1,
      viewerMemberId: "host",
      onApplyLimit: apply,
    });
    const limit = screen.getByRole("slider", { name: "玩家上限" });
    expect(limit.getAttribute("type")).toBe("range");
    expect(limit.getAttribute("min")).toBe("2");
    expect(limit.getAttribute("max")).toBe("8");
    fireEvent.change(limit, {
      target: { value: "6" },
    });
    const applyButton = screen.getByRole("button", { name: "应用" });
    expect(applyButton.dataset.paperVariant).toBe("tinted");
    expect(applyButton.dataset.paperFolded).toBe("true");
    fireEvent.click(applyButton);
    await waitFor(() => expect(apply).toHaveBeenCalledWith(6));
    const limitGroup = screen.getByRole("group", { name: "玩家上限" });
    expect(limitGroup.classList.contains("paper-segment-group")).toBe(true);
    expect(limitGroup.querySelector(".paper-range-control")).toBeTruthy();
    expect(limitGroup.querySelector(".paper-number-control")).toBeTruthy();
    expect(
      limitGroup.querySelectorAll(".paper-segment-separator"),
    ).toHaveLength(2);
    const stepper = screen.getByRole("spinbutton", {
      name: "玩家上限数值",
    }) as HTMLInputElement;
    expect(stepper.value).toBe("6");
    expect(stepper.min).toBe("2");
    expect(stepper.max).toBe("8");
    fireEvent.change(stepper, { target: { value: "5" } });
    expect((limit as HTMLInputElement).value).toBe("5");
    expect(
      limitGroup.contains(screen.getByRole("button", { name: "应用" })),
    ).toBe(true);
  });

  it("clamps the room limit to the current player count", () => {
    renderLobby({
      isHost: true,
      mySlot: 1,
      viewerMemberId: "host",
      playerCount: 3,
    });
    const input = screen.getByRole("slider", { name: "玩家上限" });
    fireEvent.change(input, { target: { value: "2" } });
    expect((input as HTMLInputElement).value).toBe("3");
  });

  it("shows claim-seat only to lobby spectators and maps a full-room race", async () => {
    const claim = vi
      .fn()
      .mockRejectedValue(new ApiRequestError("full", 409, "ROOM_FULL"));
    renderLobby({
      viewerRole: "spectator",
      viewerMemberId: "watcher",
      onClaimSeat: claim,
    });
    expect(screen.queryByRole("button", { name: "我准备好了" })).toBeNull();
    expect(screen.getByRole("button", { name: "离开观战" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "认领席位" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "席位刚被其他观战者认领",
    );
  });

  it("reports clipboard success and recoverable failure", async () => {
    renderLobby();
    const copy = screen.getByRole("button", { name: "复制房间号" });

    fireEvent.click(copy);
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("ABC234"),
    );
    expect(await screen.findByText("房间号已复制。")).toBeTruthy();

    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(
      new Error("blocked"),
    );
    fireEvent.click(copy);
    expect(
      await screen.findByText("复制失败，请手动选择房间号。"),
    ).toBeTruthy();
  });

  it("does not announce starting while a ready member is disconnected", () => {
    renderLobby({
      members: members.map((member) => ({
        ...member,
        ready: true,
        status:
          member.memberId === "guest"
            ? ("disconnected" as const)
            : ("connected" as const),
      })),
    });

    expect(screen.queryByText(/正在开始对局/)).toBeNull();
    expect(screen.getByText(/离线：Guest/)).toBeTruthy();
    expect(screen.getByText("连接恢复后才能准备。")).toBeTruthy();
  });

  it("separates host exit with an explicit room-closing consequence", () => {
    renderLobby({
      isHost: true,
      mySlot: 1,
      viewerMemberId: "host",
    });

    const leave = screen.getByRole("button", { name: "关闭并离开" });
    expect(leave.classList.contains("paper-button-danger")).toBe(true);
    expect(screen.getByText("房主离开会关闭房间。")).toBeTruthy();
  });
});
