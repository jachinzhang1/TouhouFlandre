import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GuessField } from "@touhouflandre/shared";
import {
  initialRoomState,
  type RoomActions,
  type RoomUiState,
} from "../../../hooks/useRoom";
import { RaceMatchExperience } from "./RaceMatchExperience";

const characterSearchMock = vi.hoisted(() => vi.fn());

const fields = [
  "firstAppearance",
  "releaseYear",
  "species",
  "affiliations",
  "locations",
  "hairColors",
].map((key) => ({
  key,
  label: key,
  type: "multi_enum" as const,
  visible: true,
  compareStrategy: "multiSet",
})) satisfies GuessField[];

vi.mock("../../../hooks/useCharacterSearch", () => ({
  useCharacterSearch: (query: string, options: unknown) => {
    characterSearchMock(query, options);
    return { results: [], loading: false, error: "" };
  },
}));

const members = [
  {
    memberId: "one",
    seat: 1,
    displayName: "玩家一",
    status: "connected" as const,
    ready: false,
  },
  {
    memberId: "two",
    seat: 2,
    displayName: "玩家二",
    status: "connected" as const,
    ready: false,
  },
  {
    memberId: "three",
    seat: 3,
    displayName: "玩家三",
    status: "connected" as const,
    ready: false,
  },
];

const scores = members.map((member, index) => ({
  memberId: member.memberId,
  seat: member.seat,
  score: 3 - index,
  status: "active" as const,
  bestRoundScore: 3 - index,
}));

function state(): RoomUiState {
  return {
    ...initialRoomState,
    room: {
      roomId: "room-1",
      roomCode: "ABC234",
      format: "bo3" as const,
      mode: "race" as const,
      turnSeconds: 60,
      playerLimit: 3,
      raceEliminationEnabled: true,
      minPlayers: 2,
      playerCount: 3,
      availableSeats: 0,
      status: "playing" as const,
      expiresAt: "2099-08-25T00:00:00Z",
      spectatorCount: 0,
    },
    viewer: {
      memberId: "one",
      role: "player" as const,
      seat: 1,
      displayName: "玩家一",
      status: "connected" as const,
    },
    members,
    match: {
      matchIndex: 0,
      targetWins: 2,
      scores,
      roundIndex: 1,
      maxRounds: 9,
      scoringMode: "placement" as const,
      rosterSize: 3,
      rematchReady: [],
      catalogVersion: "v1",
      activeFields: fields,
      ruleSetRef: { mode: "race" as const, key: "placement", version: 1 },
    },
    round: {
      status: "playing" as const,
      startsAt: "2026-08-25T00:00:00Z",
      deadline: "2099-08-25T00:05:00Z",
      maxGuesses: 8,
      self: {
        memberId: "one",
        seat: 1,
        participationStatus: "active" as const,
        guesses: [],
      },
      opponents: [
        {
          memberId: "two",
          seat: 2,
          fieldOrder: fields.map((field) => field.key),
          rows: [
            {
              index: 1,
              statuses: fields.map(() => "exact" as const),
            },
          ],
        },
      ],
    },
  };
}

const actions = {
  submitGuess: vi.fn(),
  forfeitRound: vi.fn(),
  rematch: vi.fn(),
} as unknown as RoomActions;

describe("RaceMatchExperience", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    vi.clearAllMocks();
  });

  it("uses the shared frame while keeping the live opponent matrix anonymous", () => {
    const { container } = render(
      <RaceMatchExperience
        state={state()}
        format="bo3"
        fields={fields}
        memberId="one"
        role="player"
        actions={actions}
        onLeave={vi.fn()}
      />,
    );

    expect(
      container.querySelector("[data-multiplayer-match-frame]"),
    ).toBeTruthy();
    expect(container.querySelector("[data-race-board-layout]")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "我" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "玩家二(P2)" })).toBeTruthy();
    const opponentRow = container.querySelector("[data-member-board] tbody tr");
    expect(opponentRow?.textContent).not.toContain("博丽灵梦");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(characterSearchMock).toHaveBeenCalledWith(
      "",
      expect.objectContaining({
        context: {
          kind: "multiplayer-match",
          roomId: "room-1",
          matchIndex: 0,
        },
      }),
    );
  });

  it("mounts the shared pulse class on the initial countdown", () => {
    const countdownState = state();
    countdownState.round = {
      ...countdownState.round!,
      status: "countdown",
      startsAt: "2099-08-25T00:00:05Z",
    };

    const { container } = render(
      <RaceMatchExperience
        state={countdownState}
        format="bo3"
        fields={fields}
        memberId="one"
        role="player"
        actions={actions}
        onLeave={vi.fn()}
      />,
    );

    const countdown = container.querySelector("[data-match-countdown]");
    expect(countdown?.classList.contains("match-countdown-band")).toBe(true);
    expect(countdown?.getAttribute("data-countdown-kind")).toBe("initial");
  });

  it("keeps spectator desktop pagination and actions read-only", () => {
    const spectatorState = state();
    spectatorState.viewer = {
      memberId: "watcher",
      role: "spectator",
      displayName: "观战者",
      status: "connected",
    } as never;
    spectatorState.round = {
      ...spectatorState.round,
      opponents: [],
      boards: members.map((member) => ({
        memberId: member.memberId,
        seat: member.seat,
        guesses: [],
      })),
    } as never;

    const { container } = render(
      <RaceMatchExperience
        state={spectatorState}
        format="bo3"
        fields={fields}
        memberId="watcher"
        role="spectator"
        actions={actions}
        onLeave={vi.fn()}
      />,
    );

    expect(screen.getByText("观战席")).toBeTruthy();
    expect(container.querySelectorAll("[data-member-board]")).toHaveLength(2);
    expect(screen.queryByLabelText("搜索角色")).toBeNull();
    expect(screen.getByRole("button", { name: "退出房间" })).toBeTruthy();
  });

  it("renders countdown and final ranking as inline regions", () => {
    const finished = state();
    finished.room!.status = "finished";
    finished.round = null;
    finished.roundResult = {
      nextStartsAt: "2099-08-25T00:00:00Z",
    } as never;
    finished.match!.scores = scores.map((score) =>
      score.memberId === "three"
        ? { ...score, status: "eliminated" as const }
        : score,
    );
    finished.matchResult = {
      matchIndex: 0,
      winnerMemberId: "one",
      scores,
      results: members.map((member, index) => ({
        memberId: member.memberId,
        seat: member.seat,
        result: index === 0 ? ("win" as const) : ("loss" as const),
      })),
      ranking: scores.map((score, index) => ({
        ...score,
        rank: index + 1,
      })),
      reason: "normal",
      retentionEndsAt: "2099-08-25T00:00:00Z",
    };

    render(
      <RaceMatchExperience
        state={finished}
        format="bo3"
        fields={fields}
        memberId="three"
        role="player"
        actions={actions}
        onLeave={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "对局结果" })).toBeTruthy();
    expect(screen.getByText(/第 1 名 · 玩家一\(P1\)/)).toBeTruthy();
    expect(screen.queryByText(/下一局将于/)).toBeNull();
    expect(screen.queryByText("竞速进行中")).toBeNull();
    expect(document.querySelector("[data-match-status]")).toBeNull();
    expect(screen.getAllByRole("button", { name: "退出房间" })).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
