import { beforeEach, describe, expect, it } from "vitest";
import type { Envelope } from "@touhouflandre/shared";
import { clearStatistics, putStatsRecord, stableRecordId, statsDb } from "./db";
import { recordMultiplayerEvent } from "./multiplayerRecorder";
import { STATS_SCHEMA_VERSION, type SingleStatsRecord } from "./types";

const event = (type: string, sequence: number, payload: unknown): Envelope => ({
  type, eventId: `evt-${sequence}`, roomId: "room-1", sequence,
  occurredAt: `2026-08-07T12:00:${String(sequence).padStart(2, "0")}Z`,
  payload: payload as Record<string, unknown>,
});

const oldRecord: SingleStatsRecord = {
  id: "old", schemaVersion: STATS_SCHEMA_VERSION, kind: "single", mode: "daily",
  startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T00:01:00Z", durationMs: 1000,
  outcome: "win", round: {
    roundIndex: 1, startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T00:01:00Z", durationMs: 1000,
    result: "win", answer: { id: "a", name: "A" }, guesses: [],
  },
};

describe("stats IndexedDB", () => {
  beforeEach(async () => {
    await statsDb.records.clear();
    await statsDb.drafts.clear();
    await statsDb.metadata.clear();
  });

  it("生成稳定且不暴露来源的记录主键", async () => {
    const first = await stableRecordId("single:secret-session");
    expect(first).toBe(await stableRecordId("single:secret-session"));
    expect(first).not.toContain("secret-session");
  });

  it("清除边界阻止旧终态通过重放重新写回", async () => {
    await clearStatistics();
    expect(await putStatsRecord(oldRecord)).toBe(false);
    expect(await statsDb.records.count()).toBe(0);
  });

  it("多人 round 重放幂等，并在 match 结束时事务归档", async () => {
    await recordMultiplayerEvent(event("match.started", 1, { format: "bo3", targetWins: 2, catalogVersion: "v1", matchIndex: 0 }), 1);
    await recordMultiplayerEvent(event("round.started", 2, { matchIndex: 0, roundIndex: 1, startsAt: "2026-08-07T12:00:02Z", deadline: "2026-08-07T12:10:02Z", maxGuesses: 8 }), 1);
    const ended = event("round.ended", 3, {
      matchIndex: 0, roundIndex: 1, result: "win", winnerSlot: 1,
      answer: { id: "reimu", name: "博丽灵梦", avatarUrl: "/reimu.png", workId: "th01", workTitle: "东方灵异传", workCode: "TH01" },
      boards: { slot1: [{ guessId: "reimu", guessName: "博丽灵梦", guessAvatarUrl: "/reimu.png", isCorrect: true, feedback: [] }], slot2: [] },
      scores: { slot1: 1, slot2: 0 },
    });
    await recordMultiplayerEvent(ended, 1, { activeElapsedMs: 5000, guessCompletedElapsedMs: [5000] });
    await recordMultiplayerEvent(ended, 1, { activeElapsedMs: 5000, guessCompletedElapsedMs: [5000] });
    await recordMultiplayerEvent(event("match.ended", 4, { matchIndex: 0, result: "win", winnerSlot: 1, scores: { slot1: 2, slot2: 0 }, reason: "normal" }), 1);
    const records = await statsDb.records.toArray();
    expect(records).toHaveLength(1);
    expect(records[0].kind === "multiplayer" && records[0].rounds).toHaveLength(1);
    expect(await statsDb.drafts.count()).toBe(0);
  });
});

