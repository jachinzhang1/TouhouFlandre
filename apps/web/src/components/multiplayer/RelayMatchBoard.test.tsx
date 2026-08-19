import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildMultiplayerGameSeed } from "../../dev/gameSeeds";
import { RelayMatchBoard } from "./RelayMatchBoard";

function renderSeed(
  preset:
    | "relay-playing"
    | "relay-opponent-turn"
    | "relay-round-result"
    | "relay-spectator-playing",
) {
  const seed = buildMultiplayerGameSeed(preset, new Date());
  return render(
    <RelayMatchBoard
      fields={[]}
      format={seed.state.room?.format ?? "bo3"}
      match={seed.state.match}
      members={seed.state.members}
      mySlot={seed.mySlot}
      riskAction={<button type="button">放弃本局</button>}
      round={seed.state.round}
      roundResult={seed.state.roundResult}
      turnAction={<button type="button">空过本手</button>}
      viewerRole={seed.role}
    />,
  );
}

describe("RelayMatchBoard", () => {
  it("prioritizes local turn ownership and labels both clocks", async () => {
    renderSeed("relay-playing");

    expect(screen.getByRole("heading", { name: "轮到你" })).toBeTruthy();
    expect(
      await screen.findByRole("timer", { name: /本手剩余时间/ }),
    ).toBeTruthy();
    expect(screen.getByRole("timer", { name: /本局剩余时间/ })).toBeTruthy();
    expect(screen.getByText("可空过 1/2 次")).toBeTruthy();
    expect(screen.getByRole("button", { name: "空过本手" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "放弃本局" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "当前比分" })).toBeTruthy();
  });

  it("renders authoritative turn chronology plus one current handoff", () => {
    renderSeed("relay-playing");

    const timeline = screen.getByRole("list", { name: "接力回合记录" });
    for (const label of ["第 1 手", "第 2 手", "第 3 手", "第 4 手"]) {
      expect(within(timeline).getByText(label)).toBeTruthy();
    }
    expect(within(timeline).getByText("主动空过")).toBeTruthy();
    expect(within(timeline).getByText("超时空过")).toBeTruthy();
    const handoff = document.querySelector('[aria-current="step"]');
    expect(handoff?.textContent).toContain("当前交接");
    expect(handoff?.textContent).toContain("P1 调试玩家（我）");
  });

  it("names the opponent turn and omits a fabricated handoff after result", () => {
    const { unmount } = renderSeed("relay-opponent-turn");
    expect(
      screen.getByRole("heading", { name: /等待 P2 雾之湖对手/ }),
    ).toBeTruthy();
    unmount();

    renderSeed("relay-round-result");
    expect(screen.getByRole("heading", { name: "本局已结束" })).toBeTruthy();
    expect(document.querySelector('[aria-current="step"]')).toBeNull();
  });

  it("uses full player identities for spectator chronology", () => {
    renderSeed("relay-spectator-playing");
    expect(
      screen.getByRole("heading", { name: /P2 雾之湖对手行动中/ }),
    ).toBeTruthy();
    expect(screen.queryByText(/第 1 手 · 我/)).toBeNull();
    expect(screen.getAllByText(/P1 调试玩家/).length).toBeGreaterThan(0);
  });
});
