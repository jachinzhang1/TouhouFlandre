import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MultiLobby } from "./MultiLobby";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("../lib/api", () => ({
  api: {
    catalogFull: vi
      .fn()
      .mockResolvedValue({ version: "v1", works: [], characters: [] }),
    createRoom: vi.fn(),
    roomInfo: vi.fn(),
    joinRoom: vi.fn(),
  },
}));

import { api } from "../lib/api";

describe("MultiLobby", () => {
  beforeEach(() => {
    localStorage.clear();
    push.mockReset();
    vi.mocked(api.createRoom)
      .mockReset()
      .mockResolvedValue({
        roomId: "room-1",
        roomCode: "ABC234",
        guestToken: "token",
        viewer: { memberId: "host", role: "player", seat: 1 },
      } as never);
  });

  it("sends playerLimit for race creation", async () => {
    render(<MultiLobby />);
    fireEvent.change(screen.getByLabelText("玩家上限（2-8）"), {
      target: { value: "6" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建房间" }));
    await waitFor(() => expect(api.createRoom).toHaveBeenCalled());
    expect(vi.mocked(api.createRoom).mock.calls[0][0]).toMatchObject({
      mode: "race",
      playerLimit: 6,
    });
  });

  it("omits race capacity for relay creation", async () => {
    render(<MultiLobby />);
    fireEvent.click(screen.getByRole("radio", { name: /接力/ }));
    fireEvent.click(screen.getByRole("button", { name: "创建房间" }));
    await waitFor(() => expect(api.createRoom).toHaveBeenCalled());
    const body = vi.mocked(api.createRoom).mock.calls[0][0];
    expect(body.mode).toBe("relay");
    expect(body).not.toHaveProperty("playerLimit");
  });
});
