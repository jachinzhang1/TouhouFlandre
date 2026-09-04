import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    raceEliminationEnabled: false,
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
  });

  it("uses memberId for self and allows ready/unready", () => {
    const props = renderLobby();
    expect(screen.getByText("Guest（我）")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "准备" }));
    expect(props.onReady).toHaveBeenCalledWith(true);
  });

  it("allows a ready player to cancel ready", () => {
    const onReady = vi.fn();
    renderLobby({
      members: members.map((member) =>
        member.memberId === "guest" ? { ...member, ready: true } : member,
      ),
      onReady,
    });
    fireEvent.click(screen.getByRole("button", { name: "取消准备" }));
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
    expect(screen.queryByRole("switch", { name: "淘汰" })).toBeNull();
  });

  it("keeps the relay lobby on the two-player flow while rollout is closed", () => {
    vi.stubEnv("NEXT_PUBLIC_MULTI_N_PLAYER_RELAY_ENABLED", "false");
    const props = renderLobby({
      mode: "relay",
      isHost: true,
      mySlot: 1,
      viewerMemberId: "host",
      playerLimit: 2,
      playerCount: 2,
      availableSeats: 0,
    });

    expect(screen.queryByRole("slider", { name: "玩家上限" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "淘汰" })).toBeNull();
    expect(screen.getByText(/当前玩家 2\/2/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "准备" }));
    expect(props.onReady).toHaveBeenCalledWith(true);
  });

  it("disables the elimination switch when the room is still two-player", () => {
    renderLobby({
      isHost: true,
      mySlot: 1,
      viewerMemberId: "host",
      playerLimit: 2,
      raceEliminationEnabled: false,
    });
    expect(screen.getByText("2 人 · 3 局 2 胜")).toBeTruthy();
    expect(
      (screen.getByRole("switch", { name: "淘汰" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("lets the host explicitly apply a changed player limit", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    renderLobby({
      isHost: true,
      mySlot: 1,
      viewerMemberId: "host",
      onApplySettings: apply,
    });
    const limit = screen.getByRole("slider", { name: "玩家上限" });
    expect(limit.getAttribute("type")).toBe("range");
    expect(limit.getAttribute("min")).toBe("2");
    expect(limit.getAttribute("max")).toBe("8");
    expect(screen.getByText("4 人 · 积分赛 · 不淘汰")).toBeTruthy();
    const elimination = screen.getByRole("switch", { name: "淘汰" });
    expect((elimination as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(limit, {
      target: { value: "6" },
    });
    expect(screen.getByText("6 人 · 积分赛 · 不淘汰")).toBeTruthy();
    fireEvent.click(elimination);
    expect(screen.getByText("6 人 · 积分赛 · 中途末位淘汰")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    await waitFor(() =>
      expect(apply).toHaveBeenCalledWith({
        playerLimit: 6,
        raceEliminationEnabled: true,
      }),
    );
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
    expect(screen.queryByRole("button", { name: "准备" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "认领席位" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "席位刚被其他观战者认领",
    );
  });

  it("atomically applies relay capacity and elimination settings", async () => {
    vi.stubEnv("NEXT_PUBLIC_MULTI_N_PLAYER_RELAY_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_MULTI_RELAY_ELIMINATION_ENABLED", "true");
    const apply = vi.fn().mockResolvedValue(undefined);
    renderLobby({
      mode: "relay",
      isHost: true,
      mySlot: 1,
      viewerMemberId: "host",
      relayEliminationEnabled: false,
      onApplySettings: apply,
    });

    const limit = screen.getByRole("slider", { name: "玩家上限" });
    expect(limit.getAttribute("step")).toBe("2");
    fireEvent.change(limit, { target: { value: "6" } });
    fireEvent.click(screen.getByRole("switch", { name: "淘汰" }));
    fireEvent.click(screen.getByRole("button", { name: "应用" }));

    await waitFor(() =>
      expect(apply).toHaveBeenCalledWith({
        playerLimit: 6,
        relayEliminationEnabled: true,
      }),
    );
  });

  it("rolls both relay drafts back when the atomic request fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_MULTI_N_PLAYER_RELAY_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_MULTI_RELAY_ELIMINATION_ENABLED", "true");
    const apply = vi
      .fn()
      .mockRejectedValue(
        new ApiRequestError("locked", 409, "ROOM_SETTINGS_LOCKED"),
      );
    renderLobby({
      mode: "relay",
      isHost: true,
      mySlot: 1,
      viewerMemberId: "host",
      relayEliminationEnabled: false,
      onApplySettings: apply,
    });

    const limit = screen.getByRole("slider", { name: "玩家上限" });
    fireEvent.change(limit, { target: { value: "6" } });
    fireEvent.click(screen.getByRole("switch", { name: "淘汰" }));
    fireEvent.click(screen.getByRole("button", { name: "应用" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "当前有人已准备",
    );
    expect((limit as HTMLInputElement).value).toBe("4");
    expect(
      screen.getByRole("switch", { name: "淘汰" }).getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("locks relay settings after anyone is ready", () => {
    vi.stubEnv("NEXT_PUBLIC_MULTI_N_PLAYER_RELAY_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_MULTI_RELAY_ELIMINATION_ENABLED", "true");
    renderLobby({
      mode: "relay",
      isHost: true,
      mySlot: 1,
      viewerMemberId: "host",
      members: members.map((member, index) => ({
        ...member,
        ready: index === 1,
      })),
    });

    expect(
      (screen.getByRole("slider", { name: "玩家上限" }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("switch", { name: "淘汰" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "应用" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("shows the authoritative odd-roster reason without a fake start notice", () => {
    renderLobby({
      mode: "relay",
      members: [
        ...members.map((member) => ({ ...member, ready: true })),
        {
          memberId: "third",
          seat: 4,
          displayName: "Third",
          status: "connected",
          ready: true,
        },
      ],
      playerCount: 3,
      startBlockedReason: "odd_player_count",
    });

    expect(screen.getByRole("status").textContent).toContain("奇数");
    expect(screen.queryByText(/对局即将开始/)).toBeNull();
  });

  it.each([
    ["player_not_ready", "还有玩家未准备"],
    ["player_disconnected", "有玩家已离线"],
    ["not_enough_players", "至少需要 2 名玩家"],
    ["host_missing", "房主当前不在房间"],
    ["invalid_player_count", "当前玩家阵容不符合"],
  ] as const)("shows authoritative %s feedback", (reason, message) => {
    renderLobby({ mode: "relay", startBlockedReason: reason });
    expect(screen.getByRole("status").textContent).toContain(message);
    expect(screen.queryByText(/对局即将开始/)).toBeNull();
  });

  it("keeps hidden relay elimination state out of a capacity request", async () => {
    vi.stubEnv("NEXT_PUBLIC_MULTI_N_PLAYER_RELAY_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_MULTI_RELAY_ELIMINATION_ENABLED", "false");
    const apply = vi.fn().mockResolvedValue(undefined);
    renderLobby({
      mode: "relay",
      isHost: true,
      mySlot: 1,
      viewerMemberId: "host",
      relayEliminationEnabled: true,
      onApplySettings: apply,
    });

    fireEvent.change(screen.getByRole("slider", { name: "玩家上限" }), {
      target: { value: "6" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用" }));

    await waitFor(() => expect(apply).toHaveBeenCalledWith({ playerLimit: 6 }));
  });
});
