import { beforeEach, describe, expect, it } from "vitest";
import { statsDb } from "./db";
import {
  applyStatsImport,
  assertStatsPrivacy,
  createStatsExport,
  parseStatsImport,
  previewStatsImport,
} from "./transfer";
import {
  STATS_SCHEMA_VERSION,
  type SingleStatsDraft,
  type SingleStatsRecord,
} from "./types";

const record = (id: string): SingleStatsRecord => ({
  id,
  schemaVersion: STATS_SCHEMA_VERSION,
  kind: "single",
  mode: "random",
  startedAt: "2026-08-07T10:00:00Z",
  endedAt: "2026-08-07T10:00:30Z",
  durationMs: 30_000,
  outcome: "win",
  round: {
    roundIndex: 1,
    startedAt: "2026-08-07T10:00:00Z",
    endedAt: "2026-08-07T10:00:30Z",
    durationMs: 30_000,
    result: "win",
    answer: { id: "reimu", name: "博丽灵梦" },
    guesses: [],
  },
});

describe("stats import/export", () => {
  beforeEach(async () => {
    await statsDb.records.clear();
    await statsDb.drafts.clear();
    await statsDb.metadata.clear();
  });

  it("导出只含版本、时间和完成记录", async () => {
    await statsDb.records.put(record("one"));
    await statsDb.drafts.put({
      id: "draft",
      kind: "single",
      sourceKey: "private-source",
      startedAt: "2026-08-07T10:00:00Z",
      updatedAt: "2026-08-07T10:00:01Z",
      mode: "random",
      activeElapsedMs: 1000,
      guessCompletedElapsedMs: [],
    } as SingleStatsDraft);
    const exported = await createStatsExport();
    expect(exported.records.map((item) => item.id)).toEqual(["one"]);
    expect(JSON.stringify(exported)).not.toContain("private-source");
  });

  it("拒绝未知版本并剥离导入记录的额外敏感字段", () => {
    expect(() =>
      parseStatsImport(
        JSON.stringify({
          schemaVersion: 999,
          exportedAt: new Date().toISOString(),
          records: [],
        }),
      ),
    ).toThrow();
    const raw = {
      schemaVersion: STATS_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      records: [{ ...record("one"), guestToken: "secret", roomCode: "ABC123" }],
    };
    const parsed = parseStatsImport(JSON.stringify(raw));
    expect(parsed.records[0]).not.toHaveProperty("guestToken");
    expect(parsed.records[0]).not.toHaveProperty("roomCode");
  });

  it("导入旧 v1 多人记录时补竞速玩法", () => {
    const raw = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      records: [
        {
          id: "multi-old",
          schemaVersion: 1,
          kind: "multiplayer",
          mode: "multiplayer",
          format: "bo1",
          matchIndex: 0,
          startedAt: "2026-08-07T10:00:00Z",
          endedAt: "2026-08-07T10:01:00Z",
          durationMs: 60_000,
          outcome: "win",
          reason: "normal",
          scoreSelf: 1,
          scoreOpponent: 0,
          rounds: [],
        },
      ],
    };
    const parsed = parseStatsImport(JSON.stringify(raw));
    expect(parsed.schemaVersion).toBe(STATS_SCHEMA_VERSION);
    expect(parsed.records[0]).toMatchObject({
      schemaVersion: STATS_SCHEMA_VERSION,
      multiplayerMode: "race",
    });
    expect(parsed.records[0]).toMatchObject({
      opponentScores: [0],
      rosterSize: 2,
      playerLimit: 2,
      scoringMode: "wins",
      tiedForFirst: false,
    });
    expect(parsed.records[0]).not.toHaveProperty("scoreOpponent");
    expect(parsed.records[0]).not.toHaveProperty("memberSlot");
  });

  it.each([
    {
      version: 1,
      fields: { scoreOpponent: 0, memberSlot: 1 },
      expected: {
        multiplayerMode: "race",
        difficulty: "unknown",
        opponentScores: [0],
        rosterSize: 2,
        playerLimit: 2,
        scoringMode: "wins",
      },
    },
    {
      version: 2,
      fields: {
        multiplayerMode: "relay",
        difficulty: "hard",
        scoreOpponent: 1,
        memberSlot: 2,
      },
      expected: {
        multiplayerMode: "relay",
        difficulty: "hard",
        opponentScores: [1],
        rosterSize: 2,
        playerLimit: 2,
        scoringMode: "wins",
      },
    },
    {
      version: 3,
      fields: {
        opponentScores: [2, 1],
        rosterSize: 3,
        playerLimit: 4,
        scoringMode: "wins",
      },
      expected: {
        multiplayerMode: "race",
        opponentScores: [2, 1],
        rosterSize: 3,
        playerLimit: 4,
        scoringMode: "wins",
      },
    },
    {
      version: 4,
      fields: {
        opponentScores: [4, 2],
        rosterSize: 3,
        playerLimit: 4,
        scoringMode: "placement",
        finalRank: 1,
        tiedForFirst: true,
        eliminatedRound: 2,
      },
      expected: {
        multiplayerMode: "race",
        scoringMode: "placement",
        finalRank: 1,
        tiedForFirst: true,
        eliminatedRound: 2,
      },
    },
    {
      version: 5,
      fields: {
        opponentScores: [5, 3, 1],
        rosterSize: 4,
        playerLimit: 8,
        scoringMode: "points",
        finalRank: 2,
        tiedForFirst: false,
      },
      expected: {
        multiplayerMode: "race",
        scoringMode: "points",
        finalRank: 2,
        tiedForFirst: false,
      },
    },
  ])(
    "导入 v$version 记录并归一化为 v5 匿名形状",
    ({ version, fields, expected }) => {
      const raw = {
        schemaVersion: version,
        exportedAt: "2026-08-23T00:00:00Z",
        records: [
          {
            id: `multi-v${version}`,
            schemaVersion: version,
            kind: "multiplayer",
            mode: "multiplayer",
            format: "bo3",
            matchIndex: 0,
            startedAt: "2026-08-23T00:00:00Z",
            endedAt: "2026-08-23T00:01:00Z",
            durationMs: 60_000,
            outcome: "win",
            reason: "normal",
            scoreSelf: 2,
            rounds: [],
            guestToken: "must-not-survive",
            memberId: "must-not-survive",
            roomCode: "ABC123",
            seat: 7,
            ...fields,
          },
        ],
      };
      const parsed = parseStatsImport(JSON.stringify(raw));
      expect(parsed.schemaVersion).toBe(STATS_SCHEMA_VERSION);
      expect(parsed.records[0]).toMatchObject({
        schemaVersion: STATS_SCHEMA_VERSION,
        ...expected,
      });
      expect(parsed.records[0]).not.toHaveProperty("guestToken");
      expect(parsed.records[0]).not.toHaveProperty("memberId");
      expect(parsed.records[0]).not.toHaveProperty("roomCode");
      expect(parsed.records[0]).not.toHaveProperty("seat");
      expect(parsed.records[0]).not.toHaveProperty("memberSlot");
    },
  );

  it("保留 v5 积分淘汰字段且导出只生成 v5", async () => {
    const raw = {
      schemaVersion: STATS_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      records: [
        {
          id: "placement",
          schemaVersion: STATS_SCHEMA_VERSION,
          kind: "multiplayer",
          mode: "multiplayer",
          format: "bo3",
          multiplayerMode: "race",
          matchIndex: 0,
          startedAt: "2026-08-07T10:00:00Z",
          endedAt: "2026-08-07T10:05:00Z",
          durationMs: 300_000,
          outcome: "draw",
          reason: "normal",
          scoreSelf: 5,
          opponentScores: [5, 2],
          rosterSize: 3,
          playerLimit: 4,
          scoringMode: "placement",
          finalRank: 1,
          tiedForFirst: true,
          eliminatedRound: 2,
          rounds: [
            {
              roundIndex: 1,
              startedAt: "2026-08-07T10:00:00Z",
              endedAt: "2026-08-07T10:01:00Z",
              durationMs: 60_000,
              result: "win",
              answer: { id: "a", name: "A" },
              guesses: [],
              pointsAwarded: 3,
              participationStatus: "correct",
            },
          ],
        },
      ],
    };
    const parsed = parseStatsImport(JSON.stringify(raw));
    expect(parsed.records[0]).toMatchObject({
      scoringMode: "placement",
      finalRank: 1,
      tiedForFirst: true,
      eliminatedRound: 2,
      rounds: [{ pointsAwarded: 3, participationStatus: "correct" }],
    });
    await statsDb.records.put(parsed.records[0]);
    const exported = await createStatsExport();
    expect(exported.schemaVersion).toBe(STATS_SCHEMA_VERSION);
    expect(
      exported.records.every(
        (item) => item.schemaVersion === STATS_SCHEMA_VERSION,
      ),
    ).toBe(true);
  });

  it("保留 v5 积分累计字段且导出只生成 v5", async () => {
    const raw = {
      schemaVersion: STATS_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      records: [
        {
          id: "points",
          schemaVersion: STATS_SCHEMA_VERSION,
          kind: "multiplayer",
          mode: "multiplayer",
          format: "bo5",
          multiplayerMode: "race",
          matchIndex: 2,
          startedAt: "2026-08-07T10:00:00Z",
          endedAt: "2026-08-07T10:06:00Z",
          durationMs: 360_000,
          outcome: "win",
          reason: "normal",
          scoreSelf: 7,
          opponentScores: [5, 3, 1],
          rosterSize: 4,
          playerLimit: 6,
          scoringMode: "points",
          finalRank: 2,
          tiedForFirst: false,
          rounds: [
            {
              roundIndex: 1,
              startedAt: "2026-08-07T10:00:00Z",
              endedAt: "2026-08-07T10:01:00Z",
              durationMs: 60_000,
              result: "win",
              answer: { id: "b", name: "B" },
              guesses: [],
              pointsAwarded: 4,
              participationStatus: "correct",
            },
          ],
        },
      ],
    };
    const parsed = parseStatsImport(JSON.stringify(raw));
    expect(parsed.records[0]).toMatchObject({
      scoringMode: "points",
      finalRank: 2,
      tiedForFirst: false,
      rounds: [{ pointsAwarded: 4, participationStatus: "correct" }],
    });
    await statsDb.records.put(parsed.records[0]);
    const exported = await createStatsExport();
    expect(exported.schemaVersion).toBe(STATS_SCHEMA_VERSION);
    expect(
      exported.records.every(
        (item) => item.schemaVersion === STATS_SCHEMA_VERSION,
      ),
    ).toBe(true);
    expect(
      exported.records.some(
        (item) => item.kind === "multiplayer" && item.scoringMode === "points",
      ),
    ).toBe(true);
  });

  it("递归拒绝统计中的身份字段", () => {
    const raw = {
      schemaVersion: STATS_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      records: [
        {
          ...record("private"),
          round: {
            ...record("private").round,
            answer: { id: "a", name: "A", memberId: "secret" },
          },
        },
      ],
    };
    const parsed = parseStatsImport(JSON.stringify(raw));
    expect(() => assertStatsPrivacy(parsed)).not.toThrow();
    expect(JSON.stringify(parsed)).not.toContain("memberId");
    expect(() =>
      assertStatsPrivacy({ nested: { memberId: "secret" } }),
    ).toThrow(/memberId/);
  });

  it("预览冲突，并分别支持合并和覆盖", async () => {
    await statsDb.records.put(record("one"));
    expect(await previewStatsImport([record("one"), record("two")])).toEqual({
      total: 2,
      additions: 1,
      replacements: 1,
    });
    await applyStatsImport([record("two")], "merge");
    expect(
      (await statsDb.records.toArray()).map((item) => item.id).sort(),
    ).toEqual(["one", "two"]);
    await applyStatsImport([record("three")], "replace");
    expect((await statsDb.records.toArray()).map((item) => item.id)).toEqual([
      "three",
    ]);
  });
});
