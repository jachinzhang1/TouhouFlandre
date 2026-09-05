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
    vi.unstubAllEnvs();
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

  it("omits race capacity while rollout is closed", async () => {
    vi.stubEnv("NEXT_PUBLIC_MULTI_N_PLAYER_RACE_ENABLED", "false");
    render(<MultiLobby />);
    expect(screen.queryByLabelText("玩家上限（2-8）")).toBeNull();
    expect(screen.queryByRole("switch", { name: "淘汰" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "创建房间" }));
    await waitFor(() => expect(api.createRoom).toHaveBeenCalled());
    const body = vi.mocked(api.createRoom).mock.calls[0][0];
    expect(body.mode).toBe("race");
    expect(body).not.toHaveProperty("playerLimit");
    expect(body.questionScope).toBeTruthy();
  });

  it("passes the host's current custom question scope when creating a room", async () => {
    vi.mocked(api.catalogFull).mockResolvedValue({
      version: "v1",
      works: [{ id: "th06_eosd" }],
      characters: [
        {
          id: "marisa_kirisame",
          enabledAsAnswer: true,
          appearanceOrder: 2,
          difficultyTier: "hard",
          firstAppearance: { workId: "th06_eosd" },
        },
      ],
    } as never);
    localStorage.setItem(
      "touhouflandre:question-scope",
      JSON.stringify({
        schemaVersion: 3,
        catalogVersion: "v1",
        mode: "custom",
        difficulty: "custom",
        selectedCharacterIds: ["marisa_kirisame"],
        workStates: [],
        rules: {
          fieldModes: {},
          turnLimit: { enabled: false, seconds: 30 },
          guessLimit: { enabled: true, maxGuesses: 7 },
        },
      }),
    );

    render(<MultiLobby />);
    fireEvent.click(screen.getByRole("button", { name: "创建房间" }));

    await waitFor(() => expect(api.createRoom).toHaveBeenCalled());
    expect(
      vi.mocked(api.createRoom).mock.calls[0][0].questionScope,
    ).toMatchObject({
      mode: "custom",
      difficulty: "custom",
      selectedCharacterIds: ["marisa_kirisame"],
      rules: { guessLimit: { enabled: true, maxGuesses: 7 } },
    });
  });

  it("sends playerLimit for race creation", async () => {
    render(<MultiLobby />);
    const limit = screen.getByLabelText("玩家上限（2-8）");
    expect(limit.getAttribute("type")).toBe("range");
    expect(limit.getAttribute("min")).toBe("2");
    expect(limit.getAttribute("max")).toBe("8");
    expect(screen.getByText("总局数")).toBeTruthy();
    expect(screen.getByText("2 人 · 3 局 2 胜")).toBeTruthy();
    const elimination = screen.getByRole("switch", { name: "淘汰" });
    expect((elimination as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(limit, {
      target: { value: "6" },
    });
    expect(screen.getByText("6 人 · 积分赛 · 不淘汰")).toBeTruthy();
    expect((elimination as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(elimination);
    expect(screen.getByText("6 人 · 积分赛 · 中途末位淘汰")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "创建房间" }));
    await waitFor(() => expect(api.createRoom).toHaveBeenCalled());
    expect(vi.mocked(api.createRoom).mock.calls[0][0]).toMatchObject({
      mode: "race",
      playerLimit: 6,
      raceEliminationEnabled: true,
    });
  });

  it("shows relay controls with the legacy two-player defaults", () => {
    render(<MultiLobby />);
    fireEvent.click(screen.getByRole("radio", { name: /接力/ }));
    const limit = screen.getByRole("slider", {
      name: "接力玩家上限（2/4/6/8）",
    });
    expect(limit).toBeTruthy();
    expect((limit as HTMLInputElement).value).toBe("2");
    const elimination = screen.getByRole("switch", { name: "淘汰" });
    expect((elimination as HTMLButtonElement).disabled).toBe(true);
    expect(elimination.getAttribute("aria-checked")).toBe("false");
  });

  it("hides and omits relay settings while its rollout is closed", async () => {
    vi.stubEnv("NEXT_PUBLIC_MULTI_N_PLAYER_RELAY_ENABLED", "false");
    render(<MultiLobby />);
    fireEvent.click(screen.getByRole("radio", { name: /接力/ }));
    expect(
      screen.queryByRole("slider", { name: "接力玩家上限（2/4/6/8）" }),
    ).toBeNull();
    expect(screen.queryByRole("switch", { name: "淘汰" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "创建房间" }));
    await waitFor(() => expect(api.createRoom).toHaveBeenCalled());
    const body = vi.mocked(api.createRoom).mock.calls[0][0];
    expect(body.mode).toBe("relay");
    expect(body).not.toHaveProperty("playerLimit");
    expect(body).not.toHaveProperty("relayEliminationEnabled");
  });

  it("creates an expanded relay with an even limit and its own elimination field", async () => {
    vi.stubEnv("NEXT_PUBLIC_MULTI_N_PLAYER_RELAY_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_MULTI_RELAY_ELIMINATION_ENABLED", "true");
    render(<MultiLobby />);

    fireEvent.click(screen.getByRole("radio", { name: /接力/ }));
    const limit = screen.getByRole("slider", {
      name: "接力玩家上限（2/4/6/8）",
    });
    expect(limit.getAttribute("min")).toBe("2");
    expect(limit.getAttribute("max")).toBe("8");
    expect(limit.getAttribute("step")).toBe("2");
    const elimination = screen.getByRole("switch", { name: "淘汰" });
    expect((elimination as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(limit, { target: { value: "6" } });
    expect((elimination as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(elimination);
    expect(screen.getByText("6 人 · 接力 · 淘汰赛")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "创建房间" }));

    await waitFor(() => expect(api.createRoom).toHaveBeenCalled());
    expect(vi.mocked(api.createRoom).mock.calls[0][0]).toMatchObject({
      mode: "relay",
      playerLimit: 6,
      relayEliminationEnabled: true,
    });
    expect(vi.mocked(api.createRoom).mock.calls[0][0]).not.toHaveProperty(
      "raceEliminationEnabled",
    );
  });

  it("keeps race and relay drafts isolated while switching modes", async () => {
    vi.stubEnv("NEXT_PUBLIC_MULTI_N_PLAYER_RELAY_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_MULTI_RELAY_ELIMINATION_ENABLED", "true");
    render(<MultiLobby />);

    fireEvent.change(screen.getByLabelText("玩家上限（2-8）"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("switch", { name: "淘汰" }));
    fireEvent.click(screen.getByRole("radio", { name: /接力/ }));
    fireEvent.change(
      screen.getByRole("slider", { name: "接力玩家上限（2/4/6/8）" }),
      { target: { value: "4" } },
    );
    fireEvent.click(screen.getByRole("switch", { name: "淘汰" }));
    fireEvent.click(screen.getByRole("radio", { name: /竞速/ }));

    expect(
      (screen.getByLabelText("玩家上限（2-8）") as HTMLInputElement).value,
    ).toBe("5");
    expect(
      (
        screen.getByRole("switch", { name: "淘汰" }) as HTMLElement
      ).getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "创建房间" }));

    await waitFor(() => expect(api.createRoom).toHaveBeenCalled());
    const body = vi.mocked(api.createRoom).mock.calls[0][0];
    expect(body).toMatchObject({
      mode: "race",
      playerLimit: 5,
      raceEliminationEnabled: true,
    });
    expect(body).not.toHaveProperty("relayEliminationEnabled");
  });

  it("does not send a hidden relay elimination setting", async () => {
    vi.stubEnv("NEXT_PUBLIC_MULTI_N_PLAYER_RELAY_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_MULTI_RELAY_ELIMINATION_ENABLED", "false");
    render(<MultiLobby />);

    fireEvent.click(screen.getByRole("radio", { name: /接力/ }));
    fireEvent.change(
      screen.getByRole("slider", { name: "接力玩家上限（2/4/6/8）" }),
      { target: { value: "8" } },
    );
    expect(screen.queryByRole("switch", { name: "淘汰" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "创建房间" }));

    await waitFor(() => expect(api.createRoom).toHaveBeenCalled());
    const body = vi.mocked(api.createRoom).mock.calls[0][0];
    expect(body).toMatchObject({ mode: "relay", playerLimit: 8 });
    expect(body).not.toHaveProperty("relayEliminationEnabled");
  });
});
