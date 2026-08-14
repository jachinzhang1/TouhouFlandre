import { beforeEach, describe, expect, it } from "vitest";
import type { Envelope } from "@touhouflandre/shared";
import { clearStatistics, putStatsRecord, stableRecordId, statsDb } from "./db";
import {
  migrateLegacyMultiplayerDraft,
  recordMultiplayerEvent,
} from "./multiplayerRecorder";
import {
  STATS_SCHEMA_VERSION,
  type MultiplayerStatsDraft,
  type SingleStatsRecord,
} from "./types";

const event = (type: string, sequence: number, payload: unknown): Envelope => ({
  type,
  eventId: `evt-${sequence}`,
  roomId: "room-1",
  sequence,
  occurredAt: `2026-08-07T12:00:${String(sequence).padStart(2, "0")}Z`,
  payload: payload as Record<string, unknown>,
});

const oldRecord: SingleStatsRecord = {
  id: "old",
  schemaVersion: STATS_SCHEMA_VERSION,
  kind: "single",
  mode: "daily",
  startedAt: "2026-01-01T00:00:00Z",
  endedAt: "2026-01-01T00:01:00Z",
  durationMs: 1000,
  outcome: "win",
  round: {
    roundIndex: 1,
    startedAt: "2026-01-01T00:00:00Z",
    endedAt: "2026-01-01T00:01:00Z",
    durationMs: 1000,
    result: "win",
    answer: { id: "a", name: "A" },
    guesses: [],
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
    await recordMultiplayerEvent(
      event("match.started", 1, {
        format: "bo3",
        mode: "race",
        turnSeconds: 60,
        targetWins: 2,
        catalogVersion: "v1",
        matchIndex: 0,
      }),
      "member-host",
    );
    await recordMultiplayerEvent(
      event("round.started", 2, {
        matchIndex: 0,
        roundIndex: 1,
        startsAt: "2026-08-07T12:00:02Z",
        deadline: "2026-08-07T12:10:02Z",
        maxGuesses: 8,
      }),
      "member-host",
    );
    const ended = event("round.ended", 3, {
      matchIndex: 0,
      roundIndex: 1,
      viewerResult: "win",
      winnerMemberId: "member-host",
      answer: {
        id: "reimu",
        name: "博丽灵梦",
        avatarUrl: "/reimu.png",
        workId: "th01",
        workTitle: "东方灵异传",
        workCode: "TH01",
      },
      boards: [
        {
          memberId: "member-host",
          seat: 1,
          guesses: [
            {
              guessId: "reimu",
              guessName: "博丽灵梦",
              guessAvatarUrl: "/reimu.png",
              isCorrect: true,
              feedback: [],
            },
          ],
        },
        { memberId: "member-guest", seat: 2, guesses: [] },
      ],
      scores: [
        { memberId: "member-host", seat: 1, score: 1 },
        { memberId: "member-guest", seat: 2, score: 0 },
      ],
      results: [
        { memberId: "member-host", seat: 1, result: "win" },
        { memberId: "member-guest", seat: 2, result: "loss" },
      ],
    });
    await recordMultiplayerEvent(ended, "member-host", {
      activeElapsedMs: 5000,
      guessCompletedElapsedMs: [5000],
    });
    await recordMultiplayerEvent(ended, "member-host", {
      activeElapsedMs: 5000,
      guessCompletedElapsedMs: [5000],
    });
    await recordMultiplayerEvent(
      event("match.ended", 4, {
        matchIndex: 0,
        viewerResult: "win",
        winnerMemberId: "member-host",
        scores: [
          { memberId: "member-host", seat: 1, score: 2 },
          { memberId: "member-guest", seat: 2, score: 0 },
        ],
        results: [
          { memberId: "member-host", seat: 1, result: "win" },
          { memberId: "member-guest", seat: 2, result: "loss" },
        ],
        reason: "normal",
      }),
      "member-host",
    );
    const records = await statsDb.records.toArray();
    expect(records).toHaveLength(1);
    expect(records[0].kind === "multiplayer" && records[0].rounds).toHaveLength(
      1,
    );
    expect(
      records[0].kind === "multiplayer" && records[0].multiplayerMode,
    ).toBe("race");
    expect(await statsDb.drafts.count()).toBe(0);
  });

  it("按 memberId 归档 N 人比分，seat 变化不改变本人关联", async () => {
    const selfId = "member-self";
    await recordMultiplayerEvent(
      event("match.started", 1, {
        format: "bo1",
        mode: "race",
        turnSeconds: 60,
        targetWins: 1,
        catalogVersion: "v1",
        matchIndex: 0,
      }),
      selfId,
      undefined,
      { playerLimit: 8 },
    );
    await recordMultiplayerEvent(
      event("round.ended", 2, {
        matchIndex: 0,
        roundIndex: 1,
        answer: {
          id: "a",
          name: "A",
          workId: "w",
          workTitle: "W",
          workCode: "W",
        },
        boards: [
          { memberId: "other-a", seat: 1, guesses: [] },
          { memberId: selfId, seat: 2, guesses: [] },
          { memberId: "other-b", seat: 3, guesses: [] },
        ],
        scores: [],
        results: [
          { memberId: "other-a", seat: 1, result: "loss" },
          { memberId: selfId, seat: 2, result: "win" },
          { memberId: "other-b", seat: 3, result: "loss" },
        ],
      }),
      selfId,
    );
    await recordMultiplayerEvent(
      event("match.ended", 3, {
        matchIndex: 0,
        winnerMemberId: selfId,
        scores: [
          { memberId: "other-a", seat: 2, score: 1 },
          { memberId: selfId, seat: 1, score: 2 },
          { memberId: "other-b", seat: 3, score: 0 },
        ],
        results: [
          { memberId: "other-a", seat: 2, result: "loss" },
          { memberId: selfId, seat: 1, result: "win" },
          { memberId: "other-b", seat: 3, result: "loss" },
        ],
        reason: "normal",
      }),
      selfId,
    );

    const record = await statsDb.records.toCollection().first();
    expect(record).toMatchObject({
      scoreSelf: 2,
      opponentScores: [1, 0],
      rosterSize: 3,
      playerLimit: 8,
      outcome: "win",
    });
    expect(JSON.stringify(record)).not.toContain(selfId);
  });

  it("normalizes relay turn actors to self and other", async () => {
    const selfId = "member-self";
    await recordMultiplayerEvent(
      event("match.started", 1, {
        format: "bo1",
        mode: "relay",
        turnSeconds: 60,
        targetWins: 1,
        catalogVersion: "v1",
        matchIndex: 0,
      }),
      selfId,
    );
    await recordMultiplayerEvent(
      event("round.ended", 2, {
        matchIndex: 0,
        roundIndex: 1,
        answer: {
          id: "a",
          name: "A",
          workId: "w",
          workTitle: "W",
          workCode: "W",
        },
        boards: [],
        turns: [
          { index: 1, memberId: selfId, seat: 2, kind: "pass" },
          { index: 2, memberId: "other", seat: 1, kind: "timeout" },
        ],
        scores: [],
        results: [
          { memberId: selfId, seat: 2, result: "draw" },
          { memberId: "other", seat: 1, result: "draw" },
        ],
      }),
      selfId,
    );
    const draft = await statsDb.drafts.toCollection().first();
    expect(draft?.kind === "multiplayer" ? draft.rounds[0]?.turns : []).toEqual(
      [
        { index: 1, actor: "self", kind: "pass" },
        { index: 2, actor: "other", kind: "timeout" },
      ],
    );
  });

  it("merges a legacy seat draft into a snapshot-created member draft", async () => {
    const oldId = await stableRecordId("multi:room-1:0:1");
    await statsDb.drafts.put({
      id: oldId,
      kind: "multiplayer",
      sourceKey: "legacy-source",
      startedAt: "2026-08-07T12:00:00Z",
      updatedAt: "2026-08-07T12:00:02Z",
      format: "bo3",
      multiplayerMode: "race",
      memberSlot: 1,
      matchIndex: 0,
      rounds: [],
      activeRound: {
        roundIndex: 1,
        startedAt: "2026-08-07T12:00:01Z",
        activeElapsedMs: 4_000,
        guessCompletedElapsedMs: [2_000],
      },
    } as MultiplayerStatsDraft);
    await recordMultiplayerEvent(
      event("match.started", 1, {
        format: "bo3",
        mode: "race",
        targetWins: 2,
        catalogVersion: "v1",
        matchIndex: 0,
      }),
      "member-self",
      undefined,
      { playerLimit: 6 },
    );

    await migrateLegacyMultiplayerDraft("room-1", 0, 1, "member-self");

    expect(await statsDb.drafts.get(oldId)).toBeUndefined();
    const migrated = await statsDb.drafts.toCollection().first();
    expect(migrated).toMatchObject({
      playerLimit: 6,
      activeRound: {
        activeElapsedMs: 4_000,
        guessCompletedElapsedMs: [2_000],
      },
    });
    expect(migrated).not.toHaveProperty("memberSlot");
    expect(JSON.stringify(migrated)).not.toContain("member-self");
    expect(JSON.stringify(migrated)).not.toContain("room-1");
  });
});
