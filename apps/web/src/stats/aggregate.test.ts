import { describe, expect, it } from "vitest";
import {
  aggregateWorks,
  buildHistogram,
  dailyStreak,
  displayGuessesForRecord,
  filterStatsRecords,
  quantile,
  summarize,
  winningGuessDistribution,
} from "./aggregate";
import {
  STATS_SCHEMA_VERSION,
  type StatsRecord,
  type StatsRound,
} from "./types";

const round = (
  roundIndex: number,
  result: "win" | "loss" | "draw",
  workId = "th06",
  guesses = 2,
): StatsRound => ({
  roundIndex,
  startedAt: `2026-01-0${roundIndex}T10:00:00Z`,
  endedAt: `2026-01-0${roundIndex}T10:01:00Z`,
  durationMs: roundIndex * 10_000,
  result,
  answer: {
    id: `answer-${roundIndex}`,
    name: `答案 ${roundIndex}`,
    work: {
      id: workId,
      title: workId === "th06" ? "东方红魔乡" : "东方妖妖梦",
      code: workId === "th06" ? "TH06" : "TH07",
    },
  },
  guesses: Array.from({ length: guesses }, (_, index) => ({
    id: `guess-${roundIndex}-${index}`,
    name: `猜测 ${index}`,
    correct: result === "win" && index === guesses - 1,
    durationMs: 1000 * (index + 1),
  })),
});

const records: StatsRecord[] = [
  {
    id: "daily-win",
    schemaVersion: STATS_SCHEMA_VERSION,
    kind: "single",
    mode: "daily",
    puzzleKey: "2026-01-01",
    startedAt: "2026-01-01T10:00:00Z",
    endedAt: "2026-01-01T10:01:00Z",
    durationMs: 10_000,
    outcome: "win",
    round: round(1, "win", "th06", 2),
  },
  {
    id: "random-loss",
    schemaVersion: STATS_SCHEMA_VERSION,
    kind: "single",
    mode: "random",
    startedAt: "2026-01-02T10:00:00Z",
    endedAt: "2026-01-02T10:01:00Z",
    durationMs: 20_000,
    outcome: "loss",
    round: round(2, "loss", "th07", 3),
  },
  {
    id: "multi-win",
    schemaVersion: STATS_SCHEMA_VERSION,
    kind: "multiplayer",
    mode: "multiplayer",
    format: "bo3",
    multiplayerMode: "race",
    ruleSetKey: "wins",
    ruleSetVersion: 1,
    matchIndex: 0,
    startedAt: "2026-01-03T10:00:00Z",
    endedAt: "2026-01-03T10:03:00Z",
    durationMs: 70_000,
    outcome: "win",
    reason: "normal",
    scoreSelf: 2,
    opponentScores: [1],
    rosterSize: 2,
    playerLimit: 2,
    rounds: [
      round(1, "win", "th06", 1),
      round(2, "loss", "th07", 2),
      round(3, "win", "th06", 3),
    ],
  },
];

describe("stats aggregation", () => {
  it("按 match 统计多人游玩次数，按 round 统计作品", () => {
    expect(summarize(records)).toMatchObject({
      plays: 3,
      wins: 2,
      losses: 1,
      draws: 0,
    });
    expect(aggregateWorks(records)).toEqual([
      {
        id: "th06",
        code: "TH06",
        title: "东方红魔乡",
        total: 3,
        wins: 3,
        winRate: 1,
      },
      {
        id: "th07",
        code: "TH07",
        title: "东方妖妖梦",
        total: 2,
        wins: 0,
        winRate: 0,
      },
    ]);
    expect(winningGuessDistribution(records)).toEqual([
      { guesses: 1, count: 1 },
      { guesses: 2, count: 1 },
      { guesses: 3, count: 1 },
    ]);
  });

  it("支持模式、日期和多人赛制筛选", () => {
    expect(
      filterStatsRecords(records, {
        mode: "multiplayer",
        format: "bo3",
        multiplayerMode: "all",
      }),
    ).toHaveLength(1);
    expect(
      filterStatsRecords(records, {
        mode: "all",
        format: "all",
        multiplayerMode: "race",
      }).map((item) => item.id),
    ).toEqual(["multi-win"]);
    expect(
      filterStatsRecords(records, {
        mode: "all",
        format: "all",
        multiplayerMode: "all",
        from: "2026-01-02",
        to: "2026-01-02",
      }).map((item) => item.id),
    ).toEqual(["random-loss"]);
  });

  it("处理零分母、分位数和直方图区间", () => {
    expect(summarize([]).winRate).toBe(0);
    expect(quantile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(quantile([10, 20, 30, 40], 0.9)).toBeCloseTo(37);
    expect(
      buildHistogram([0, 999, 1000], 2).reduce(
        (sum, bin) => sum + bin.count,
        0,
      ),
    ).toBe(3);
  });

  it("每日连胜可跨年，并允许今天尚未游玩时延续到昨天", () => {
    const streakRecords = ["2025-12-31", "2026-01-01", "2026-01-02"].map(
      (puzzleKey, index) => ({
        ...records[0],
        id: `daily-${index}`,
        puzzleKey,
        startedAt: `${puzzleKey}T10:00:00Z`,
        endedAt: `${puzzleKey}T10:01:00Z`,
      }),
    ) as StatsRecord[];
    expect(dailyStreak(streakRecords, new Date("2026-01-03T12:00:00"))).toEqual(
      { current: 3, longest: 3 },
    );
  });

  it("接力游玩记录只展示本地玩家的猜测头像", () => {
    const relayRecord: StatsRecord = {
      id: "relay",
      schemaVersion: STATS_SCHEMA_VERSION,
      kind: "multiplayer",
      mode: "multiplayer",
      format: "bo3",
      multiplayerMode: "relay",
      ruleSetKey: "legacy_wins",
      ruleSetVersion: 1,
      matchIndex: 0,
      startedAt: "2026-01-04T10:00:00Z",
      endedAt: "2026-01-04T10:04:00Z",
      durationMs: 120_000,
      outcome: "loss",
      reason: "normal",
      scoreSelf: 0,
      opponentScores: [2],
      rosterSize: 2,
      playerLimit: 2,
      rounds: [
        {
          ...round(4, "loss", "th06", 0),
          guesses: [
            { id: "mine", name: "我的猜测", correct: false },
            { id: "opponent", name: "对手猜测", correct: true },
          ],
          turns: [
            {
              index: 1,
              actor: "self",
              kind: "guess",
              guess: { id: "mine", name: "我的猜测", correct: false },
            },
            {
              index: 2,
              actor: "other",
              kind: "guess",
              guess: { id: "opponent", name: "对手猜测", correct: true },
            },
          ],
        },
      ],
    };

    expect(
      displayGuessesForRecord(relayRecord).map((guess) => guess.id),
    ).toEqual(["mine"]);
  });
});
