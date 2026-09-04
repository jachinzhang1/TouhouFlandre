import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RelayEncounterView } from "@touhouflandre/shared";
import type { RelayProjectionState } from "../domain/relayProjection";
import type { RoomActions } from "../hooks/useRoom";
import { RelayStageView } from "./RelayStageView";

const historyMocks = vi.hoisted(() => ({
  loadStage: vi.fn(() => Promise.resolve()),
  retryStage: vi.fn(() => Promise.resolve()),
}));

vi.mock("../hooks/useRelayHistory", () => ({
  useRelayHistory: () => ({
    stagesByIndex: {},
    loadingStageIndex: null,
    errorByStageIndex: {},
    ...historyMocks,
  }),
}));

vi.mock("./game/GuessInputBar", () => ({
  GuessInputBar: ({
    disabled,
    onGuess,
    searchContext,
    statusMessage,
  }: {
    disabled: boolean;
    onGuess: (guessId: string) => Promise<unknown>;
    searchContext?: { roomId: string; matchIndex: number };
    statusMessage?: string | null;
  }) => (
    <button
      type="button"
      data-testid="relay-guess-input"
      data-search-room-id={searchContext?.roomId}
      data-search-match-index={searchContext?.matchIndex}
      disabled={disabled}
      title={statusMessage ?? "可猜测"}
      onClick={() => void onGuess("reimu")}
    >
      猜测
    </button>
  ),
}));

const members = Array.from({ length: 8 }, (_, index) => ({
  memberId: `member-${index + 1}`,
  seat: index + 1,
  displayName: index < 2 ? "同名玩家" : `玩家 ${index + 1}`,
  status: "connected" as const,
  ready: true,
}));

function encounter(index: number): RelayEncounterView {
  const first = members[(index - 1) * 2];
  const second = members[(index - 1) * 2 + 1];
  return {
    encounterId: `encounter-${index}`,
    encounterIndex: index,
    status: "playing",
    members: [
      { memberId: first.memberId, seat: first.seat, side: 1 },
      { memberId: second.memberId, seat: second.seat, side: 2 },
    ],
    capabilities:
      index === 1
        ? { canGuess: true, canPass: true, canForfeit: true }
        : { canGuess: false, canPass: false, canForfeit: false },
    turnMemberId: first.memberId,
    maxTurnsPerPlayer: 8,
    maxSkipsPerPlayer: 2,
    rows: [],
  };
}

function projection(
  overrides: Partial<RelayProjectionState> = {},
): RelayProjectionState {
  const encounters = Array.from({ length: 4 }, (_, index) =>
    encounter(index + 1),
  );
  return {
    matchIndex: 0,
    sequence: 10,
    ruleSetRef: { mode: "relay", key: "elimination", version: 1 },
    plannedStages: 3,
    ranking: [],
    currentStageIndex: 1,
    standings: members.map((member) => ({
      memberId: member.memberId,
      seat: member.seat,
      score: 10 - member.seat,
      status: "active" as const,
      lifeState: "healthy" as const,
    })),
    stagesByIndex: {
      1: {
        stageId: "stage-1",
        stageIndex: 1,
        status: "playing",
        encounters,
        encounterDetails: encounters,
      },
    },
    viewerMemberId: "member-1",
    viewerRole: "player",
    ...overrides,
  };
}

function renderRelay(
  relayProjection = projection(),
  viewer: {
    memberId: string;
    role: "player" | "spectator";
    seat?: number;
    displayName: string;
    status: "connected";
  } = {
    memberId: "member-1",
    role: "player",
    seat: 1,
    displayName: "同名玩家",
    status: "connected",
  },
) {
  const relayEncounterAction = vi.fn(() => Promise.resolve());
  const renderProjection = (nextProjection = relayProjection) => (
    <RelayStageView
      roomId="room-1"
      token="token"
      format="bo3"
      projection={nextProjection}
      members={members}
      viewer={viewer}
      fields={[]}
      roomStatus="playing"
      retentionEndsAt={null}
      matchResult={null}
      rematchReady={[]}
      actions={{ relayEncounterAction } as unknown as RoomActions}
      onRematch={vi.fn()}
      onLeave={vi.fn()}
    />
  );
  return {
    ...render(renderProjection()),
    relayEncounterAction,
    renderProjection,
  };
}

describe("RelayStageView", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.clearAllMocks();
  });

  it("mounts one of four boards and keeps actions bound to the own encounter", async () => {
    const { container, relayEncounterAction } = renderRelay();

    await screen.findByRole("heading", {
      name: "同名玩家(P1) vs 同名玩家(P2)",
    });
    expect(container.querySelectorAll("[data-relay-board]")).toHaveLength(1);
    expect(container.querySelectorAll("table")).toHaveLength(1);
    expect(
      (screen.getByTestId("relay-guess-input") as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      screen.getByTestId("relay-guess-input").getAttribute("data-search-room-id"),
    ).toBe("room-1");
    expect(
      screen
        .getByTestId("relay-guess-input")
        .getAttribute("data-search-match-index"),
    ).toBe("0");
    expect(screen.queryByText("9", { selector: "strong" })).not.toBeNull();
    expect(
      screen
        .getAllByRole("listitem")
        .some((item) => item.textContent?.includes("同名玩家(我)9")),
    ).toBe(true);
    expect(
      screen
        .getAllByRole("listitem")
        .some((item) => item.textContent?.includes("同名玩家(P2)8")),
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "下一张棋盘" }));
    await screen.findByRole("heading", { name: "玩家 3(P3) vs 玩家 4(P4)" });
    expect(container.querySelectorAll("[data-relay-board]")).toHaveLength(1);
    expect(container.querySelectorAll("table")).toHaveLength(1);
    expect(
      (screen.getByTestId("relay-guess-input") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByRole("status").textContent).toContain(
      "正在浏览其他对局，操作已禁用",
    );
    expect(
      JSON.parse(
        window.sessionStorage.getItem("touhouflandre:relay-view:room-1:0") ??
          "{}",
      ),
    ).toMatchObject({ encounterId: "encounter-2" });

    fireEvent.click(screen.getByRole("button", { name: "上一张棋盘" }));
    await waitFor(() =>
      expect(
        (screen.getByTestId("relay-guess-input") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByTestId("relay-guess-input"));
    expect(relayEncounterAction).toHaveBeenCalledWith(
      { stageIndex: 1, encounterId: "encounter-1" },
      "guess",
      "reimu",
    );
  });

  it("resets a previous match selection when the next match has no saved view", async () => {
    window.sessionStorage.setItem(
      "touhouflandre:relay-view:room-1:0",
      JSON.stringify({
        scope: "current",
        stageIndex: 1,
        encounterId: "encounter-2",
      }),
    );
    const rendered = renderRelay();

    await screen.findByRole("heading", { name: "玩家 3(P3) vs 玩家 4(P4)" });
    rendered.rerender(rendered.renderProjection(projection({ matchIndex: 1 })));

    await screen.findByRole("heading", {
      name: "同名玩家(P1) vs 同名玩家(P2)",
    });
    await waitFor(() =>
      expect(
        JSON.parse(
          window.sessionStorage.getItem("touhouflandre:relay-view:room-1:1") ??
            "{}",
        ),
      ).toMatchObject({
        scope: "current",
        stageIndex: 1,
        encounterId: "encounter-1",
      }),
    );
  });

  it("announces bye, near-death, elimination and spectator states without dialogs", () => {
    const byeProjection = projection({
      standings: projection().standings.map((standing) =>
        standing.memberId === "member-1"
          ? { ...standing, lifeState: "near_death" as const }
          : standing,
      ),
      stagesByIndex: {
        1: {
          ...projection().stagesByIndex[1],
          byeMemberId: "member-1",
          encounterDetails:
            projection().stagesByIndex[1].encounterDetails?.slice(1),
          encounters: projection().stagesByIndex[1].encounters.slice(1),
        },
      },
    });
    const { unmount } = renderRelay(byeProjection);
    expect(screen.getByRole("status").textContent).toContain(
      "你本轮轮空，可以浏览其他对局",
    );
    const selfScore = screen
      .getAllByRole("listitem")
      .find((item) => item.textContent?.includes("同名玩家(我)"));
    expect(selfScore?.textContent).toContain("濒死");
    expect(selfScore?.textContent).toContain("轮空");
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();

    window.sessionStorage.clear();
    renderRelay(
      projection({
        standings: projection().standings.map((standing) =>
          standing.memberId === "member-1"
            ? {
                ...standing,
                status: "eliminated" as const,
                lifeState: "near_death" as const,
              }
            : standing,
        ),
      }),
    );
    expect(screen.getByRole("status").textContent).toContain(
      "你已淘汰，可以继续浏览所有棋盘",
    );
    const eliminatedScore = screen
      .getAllByRole("listitem")
      .find((item) => item.textContent?.includes("同名玩家(我)"));
    expect(eliminatedScore?.textContent).toContain("已淘汰");
    expect(eliminatedScore?.textContent).not.toContain("濒死");
  });

  it("announces the server-timed countdown before the first stage starts", async () => {
    const plannedEncounters = Array.from({ length: 4 }, (_, index) => ({
      ...encounter(index + 1),
      status: "planned" as const,
      capabilities: {
        canGuess: false,
        canPass: false,
        canForfeit: false,
      },
    }));
    renderRelay(
      projection({
        stagesByIndex: {
          1: {
            stageId: "stage-1",
            stageIndex: 1,
            startsAt: new Date(Date.now() + 5000).toISOString(),
            status: "planned",
            encounters: plannedEncounters,
          },
        },
      }),
    );

    const message = await screen.findByText(/对局将于 [1-5] 秒后开始/);
    const countdown = message.closest("[data-match-countdown]");
    expect(countdown?.classList.contains("match-countdown-band")).toBe(true);
    expect(countdown?.getAttribute("data-countdown-kind")).toBe("initial");
    expect(screen.queryByText(/下一局将于/)).toBeNull();
  });

  it("keeps the ended board visible during the server-timed stage intermission", async () => {
    const ended = encounter(1);
    ended.status = "ended";
    ended.capabilities = {
      canGuess: false,
      canPass: false,
      canForfeit: false,
    };
    ended.answer = {
      id: "reimu",
      name: "博丽灵梦",
      avatarUrl: "/reimu.png",
      workId: "th06",
      workTitle: "东方红魔乡",
      workCode: "TH06",
    };
    ended.winnerMemberId = "member-1";
    ended.outcome = "win";
    const previousEncounters = [
      ended,
      encounter(2),
      encounter(3),
      encounter(4),
    ].map((item) => ({
      ...item,
      status: "ended" as const,
      capabilities: {
        canGuess: false,
        canPass: false,
        canForfeit: false,
      },
    }));
    const nextEncounters = Array.from({ length: 4 }, (_, index) => ({
      ...encounter(index + 1),
      encounterId: `next-encounter-${index + 1}`,
      status: "planned" as const,
    }));
    renderRelay(
      projection({
        currentStageIndex: 2,
        stagesByIndex: {
          1: {
            stageId: "stage-1",
            stageIndex: 1,
            status: "ended",
            encounters: previousEncounters,
            encounterDetails: previousEncounters,
          },
          2: {
            stageId: "stage-2",
            stageIndex: 2,
            startsAt: new Date(Date.now() + 5000).toISOString(),
            status: "planned",
            encounters: nextEncounters,
            byeMemberId: "member-3",
          },
        },
      }),
    );

    expect(await screen.findByText(/下一局将于 [1-5] 秒后开始/)).not.toBeNull();
    expect(
      screen.getByRole("heading", {
        name: "同名玩家(P1) vs 同名玩家(P2)",
      }),
    ).not.toBeNull();
    expect(screen.getByText("答案：博丽灵梦 · 东方红魔乡")).not.toBeNull();
    expect(screen.getByText("本轮有轮空")).not.toBeNull();
    expect(screen.queryByText("TH06")).toBeNull();
    expect(screen.queryByText("等待棋盘同步。")).toBeNull();
  });

  it("shows terminal encounter, spectator and final ranking as inline regions", () => {
    const ended = encounter(1);
    ended.status = "ended";
    ended.capabilities = { canGuess: false, canPass: false, canForfeit: false };
    ended.winnerMemberId = "member-2";
    ended.outcome = "win";
    const endedProjection = projection({
      stagesByIndex: {
        1: {
          ...projection().stagesByIndex[1],
          encounterDetails: [ended, encounter(2), encounter(3), encounter(4)],
        },
      },
    });
    const first = renderRelay(endedProjection);
    expect(screen.getByRole("status").textContent).toContain(
      "对手已猜中本局，等待其他棋盘完成",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    first.unmount();

    window.sessionStorage.clear();
    const spectatorProjection = projection({
      viewerMemberId: "spectator-1",
      viewerRole: "spectator",
    });
    const spectator = renderRelay(spectatorProjection, {
      memberId: "spectator-1",
      role: "spectator",
      displayName: "观战者",
      status: "connected",
    });
    expect(screen.getByRole("status").textContent).toContain(
      "只读观战，可以浏览所有对局",
    );
    expect(screen.queryByTestId("relay-guess-input")).toBeNull();
    spectator.unmount();

    window.sessionStorage.clear();
    const finished = projection({
      ranking: [
        {
          memberId: "member-1",
          seat: 1,
          rank: 1,
          score: 9,
          status: "active",
          lifeState: "healthy",
          survivedStages: 3,
        },
        {
          memberId: "member-2",
          seat: 2,
          rank: 1,
          score: 9,
          status: "active",
          lifeState: "healthy",
          survivedStages: 3,
        },
      ],
    });
    const { container } = render(
      <RelayStageView
        roomId="room-1"
        token="token"
        format="bo3"
        projection={finished}
        members={members}
        viewer={{
          memberId: "member-1",
          role: "player",
          seat: 1,
          displayName: "同名玩家",
          status: "connected",
        }}
        fields={[]}
        roomStatus="finished"
        retentionEndsAt="2099-08-25T00:00:00Z"
        matchResult={null}
        rematchReady={[]}
        actions={{ relayEncounterAction: vi.fn() } as unknown as RoomActions}
        onRematch={vi.fn()}
        onLeave={vi.fn()}
      />,
    );
    const ranking = screen
      .getByRole("heading", { name: "最终排名" })
      .closest("section");
    expect(ranking).not.toBeNull();
    expect(within(ranking!).getAllByText(/第 1 名/)).toHaveLength(2);
    expect(container.querySelector("[data-relay-status]")).toBeNull();
    expect(screen.queryByText("你已猜中本局")).toBeNull();
    expect(screen.queryByText("对手已猜中本局")).toBeNull();
    expect(screen.queryByRole("button", { name: "主动空过本手" })).toBeNull();
    expect(screen.queryByRole("button", { name: "放弃本局" })).toBeNull();
    expect(container.querySelectorAll("[data-relay-board]")).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
