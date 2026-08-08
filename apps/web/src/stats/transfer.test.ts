import { beforeEach, describe, expect, it } from "vitest";
import { statsDb } from "./db";
import {
  applyStatsImport,
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
    expect(() => parseStatsImport(JSON.stringify({ schemaVersion: 999, exportedAt: new Date().toISOString(), records: [] }))).toThrow();
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
      records: [{
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
      }],
    };
    const parsed = parseStatsImport(JSON.stringify(raw));
    expect(parsed.schemaVersion).toBe(STATS_SCHEMA_VERSION);
    expect(parsed.records[0]).toMatchObject({ schemaVersion: STATS_SCHEMA_VERSION, multiplayerMode: "race" });
  });

  it("预览冲突，并分别支持合并和覆盖", async () => {
    await statsDb.records.put(record("one"));
    expect(await previewStatsImport([record("one"), record("two")])).toEqual({
      total: 2,
      additions: 1,
      replacements: 1,
    });
    await applyStatsImport([record("two")], "merge");
    expect((await statsDb.records.toArray()).map((item) => item.id).sort()).toEqual(["one", "two"]);
    await applyStatsImport([record("three")], "replace");
    expect((await statsDb.records.toArray()).map((item) => item.id)).toEqual(["three"]);
  });
});
