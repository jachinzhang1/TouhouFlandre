import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../lib/api";
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

  it("lets the host explicitly apply a changed player limit", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    renderLobby({
      isHost: true,
      mySlot: 1,
      viewerMemberId: "host",
      onApplyLimit: apply,
    });
    fireEvent.change(screen.getByLabelText("玩家上限"), {
      target: { value: "6" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith(6));
  });

  it("clamps the room limit to the current player count", () => {
    renderLobby({
      isHost: true,
      mySlot: 1,
      viewerMemberId: "host",
      playerCount: 3,
    });
    const input = screen.getByLabelText("玩家上限");
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
});
