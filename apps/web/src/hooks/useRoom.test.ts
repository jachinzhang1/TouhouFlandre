// useRoom reducer 单测（08 §10.3）：乱序/重复去重、事件应用、局/场流转。
import { describe, expect, it } from "vitest";
import type { Envelope } from "@touhouflandre/shared";
import type { RoomUiState } from "../hooks/useRoom";
import { applySnapshot, initialRoomState, roomReducer } from "../hooks/useRoom";

const event = (type: string, sequence: number, payload: unknown): Envelope =>
  ({
    type,
    eventId: `evt-${sequence}`,
    roomId: "room-1",
    sequence,
    occurredAt: "2026-08-06T12:00:00Z",
    payload,
  }) as unknown as Envelope;

describe("roomReducer", () => {
  it("room.updated 更新成员列表", () => {
    const state = roomReducer(initialRoomState, event("room.updated", 1, {
      format: "bo3",
      mode: "race",
      turnSeconds: 60,
      members: [{ slot: 1, displayName: "房主", status: "connected", ready: false }],
    }));
    expect(state.members).toHaveLength(1);
    expect(state.room).toBeNull(); // room 信息由快照提供
  });

  it("match.started 重置比分与历史（新场行）", () => {
    let state: RoomUiState = {
      ...initialRoomState,
      match: { matchIndex: 0, targetWins: 2, scoreSlot1: 1, scoreSlot2: 0, roundIndex: 1, maxRounds: 9, rematchReady: [false, false] },
      history: [{ roundIndex: 1, result: "win" as const }],
    };
    state = roomReducer(state, event("match.started", 3, {
      format: "bo3", mode: "race", turnSeconds: 60, targetWins: 2, catalogVersion: "v1", matchIndex: 1,
    }));
    expect(state.match?.matchIndex).toBe(1);
    expect(state.match?.scoreSlot1).toBe(0);
    expect(state.history).toHaveLength(0);
    expect(state.round).toBeNull();
  });

  it("round.started 建局且 round.playing 解锁（弹窗在 playing 时关闭）", () => {
    let state: RoomUiState = { ...initialRoomState, match: { matchIndex: 0, targetWins: 2, scoreSlot1: 0, scoreSlot2: 0, roundIndex: 1, maxRounds: 9, rematchReady: [false, false] } };
    state = roomReducer(state, event("round.started", 4, {
      matchIndex: 0, roundIndex: 1, startsAt: "2026-08-06T12:00:03Z", deadline: "2026-08-06T12:15:03Z", maxGuesses: 8,
    }));
    expect(state.round?.status).toBe("countdown");
    state = roomReducer(state, event("round.ended", 5, {
      matchIndex: 0, roundIndex: 1, result: "win", winnerSlot: 1, scores: { slot1: 1, slot2: 0 },
      answer: { id: "a", name: "A", avatarUrl: "" },
      boards: { slot1: [], slot2: [] },
    }));
    expect(state.roundResult?.result).toBe("win");
    // 下一局 started：弹窗保留（显示倒计时）
    state = roomReducer(state, event("round.started", 6, {
      matchIndex: 0, roundIndex: 2, startsAt: "2026-08-06T12:00:08Z", deadline: "2026-08-06T12:15:08Z", maxGuesses: 8,
    }));
    expect(state.roundResult).not.toBeNull();
    expect(state.round?.status).toBe("countdown");
    // round.playing：弹窗关闭，新局可猜
    state = roomReducer(state, event("round.playing", 7, { matchIndex: 0, roundIndex: 2 }));
    expect(state.roundResult).toBeNull();
    expect(state.round?.status).toBe("playing");
  });

  it("round.opponent.guess 追加对手行；round.ended 更新比分与历史", () => {
    let state: RoomUiState = { ...initialRoomState, match: { matchIndex: 0, targetWins: 2, scoreSlot1: 0, scoreSlot2: 0, roundIndex: 1, maxRounds: 9, rematchReady: [false, false] } };
    state = roomReducer(state, event("round.started", 4, {
      matchIndex: 0, roundIndex: 1, startsAt: "2026-08-06T12:00:03Z", deadline: "2026-08-06T12:15:03Z", maxGuesses: 8,
    }));
    state = roomReducer(state, event("round.opponent.guess", 5, {
      matchIndex: 0, roundIndex: 1, rowIndex: 1, statuses: ["miss", "exact", "partial", "lower", "miss", "unknown"],
    }));
    expect(state.round?.opponent.rows).toHaveLength(1);
    state = roomReducer(state, event("round.ended", 6, {
      matchIndex: 0, roundIndex: 1, result: "loss", winnerSlot: 2, scores: { slot1: 0, slot2: 1 },
      answer: { id: "a", name: "A", avatarUrl: "" }, boards: { slot1: [], slot2: [] },
    }));
    expect(state.match?.scoreSlot2).toBe(1);
    expect(state.history[0]).toEqual({ roundIndex: 1, result: "loss" });
  });

  it("接力事件追加共享行并更新当前手", () => {
    let state: RoomUiState = { ...initialRoomState, match: { matchIndex: 0, targetWins: 2, scoreSlot1: 0, scoreSlot2: 0, roundIndex: 1, maxRounds: 9, rematchReady: [false, false] } };
    state = roomReducer(state, event("round.started", 4, {
      matchIndex: 0,
      roundIndex: 1,
      startsAt: "2026-08-06T12:00:03Z",
      deadline: "2026-08-06T12:15:03Z",
      maxGuesses: 8,
      turnSlot: 1,
      turnDeadline: "2026-08-06T12:01:03Z",
      maxTurnsPerPlayer: 8,
      maxSkipsPerPlayer: 2,
    }));
    expect(state.round?.maxSkipsPerPlayer).toBe(2);
    state = roomReducer(state, event("round.shared.guess", 5, {
      matchIndex: 0,
      roundIndex: 1,
      row: { index: 1, memberSlot: 1, kind: "guess", guess: { guessId: "a", guessName: "A", isCorrect: false, feedback: [] } },
      nextTurnSlot: 2,
      nextTurnDeadline: "2026-08-06T12:02:03Z",
    }));
    expect(state.round?.shared?.rows).toHaveLength(1);
    expect(state.round?.turnSlot).toBe(2);
    state = roomReducer(state, event("round.turn.timeout", 6, {
      matchIndex: 0,
      roundIndex: 1,
      row: { index: 2, memberSlot: 2, kind: "timeout" },
      nextTurnSlot: 1,
      nextTurnDeadline: "2026-08-06T12:03:03Z",
    }));
    expect(state.round?.shared?.rows).toHaveLength(2);
    expect(state.round?.turnSlot).toBe(1);
    state = roomReducer(state, event("round.turn.pass", 7, {
      matchIndex: 0,
      roundIndex: 1,
      row: { index: 3, memberSlot: 1, kind: "pass" },
      nextTurnSlot: 2,
      nextTurnDeadline: "2026-08-06T12:04:03Z",
    }));
    expect(state.round?.shared?.rows).toHaveLength(3);
    expect(state.round?.shared?.rows[2]?.kind).toBe("pass");
    expect(state.round?.turnSlot).toBe(2);
  });

  it("match.ended 切终态（finished）", () => {
    const existingRoundResult = {
      matchIndex: 0,
      roundIndex: 2,
      result: "win",
      winnerSlot: 1,
      scores: { slot1: 2, slot2: 0 },
      answer: { id: "a", name: "A", avatarUrl: "", workId: "th01", workTitle: "TH01", workCode: "TH01" },
      boards: { slot1: [], slot2: [] },
    };
    const state = roomReducer(
      { ...initialRoomState, room: { roomId: "room-1", roomCode: "ABC123", format: "bo3", mode: "race", turnSeconds: 60, status: "playing" }, match: { matchIndex: 0, targetWins: 2, scoreSlot1: 1, scoreSlot2: 0, roundIndex: 2, maxRounds: 9, rematchReady: [false, false] }, round: { status: "ended", startsAt: "2026-08-06T12:00:03Z", deadline: "2026-08-06T12:15:03Z", maxGuesses: 8, self: { guesses: [] }, opponent: { rows: [] } }, roundResult: existingRoundResult } as RoomUiState,
      event("match.ended", 9, { matchIndex: 0, result: "win", winnerSlot: 1, scores: { slot1: 2, slot2: 0 }, reason: "normal" }),
    );
    expect(state.matchResult?.reason).toBe("normal");
    expect(state.roundResult?.answer.name).toBe("A");
    expect(state.round?.status).toBe("ended");
    expect(state.room?.status).toBe("finished");
  });

  it("match.rematch 标记确认；room.closed 终态", () => {
    let state = roomReducer({ ...initialRoomState, room: { roomId: "room-1", roomCode: "ABC123", format: "bo3", mode: "race", turnSeconds: 60, status: "finished" }, rematchReady: [false, false] } as RoomUiState, event("match.rematch", 10, { memberSlot: 2 }));
    expect(state.rematchReady).toEqual([false, true]);
    state = roomReducer(state, event("room.closed", 11, { reason: "member_left" }));
    expect(state.room?.status).toBe("closed");
  });

  it("乱序/重复按 sequence 去重", () => {
    // 模拟调用方去重：sequence 不递增的事件被跳过
    let applied = 0;
    let state = initialRoomState;
    for (const e of [
      event("room.updated", 5, { format: "bo3", mode: "race", turnSeconds: 60, members: [] }),
      event("room.updated", 3, { format: "bo3", mode: "race", turnSeconds: 60, members: [] }), // 乱序：跳过
      event("room.updated", 5, { format: "bo3", mode: "race", turnSeconds: 60, members: [] }), // 重复：跳过
    ]) {
      if (e.sequence <= applied) continue;
      applied = e.sequence;
      state = roomReducer(state, e);
    }
    expect(applied).toBe(5);
  });
});

describe("applySnapshot", () => {
  it("快照应用状态并回放事件（去重）", () => {
    const snapshot = {
      roomId: "room-1",
      roomCode: "ABC123",
      format: "bo3",
      mode: "race",
      turnSeconds: 60,
      status: "playing",
      members: [{ slot: 1, displayName: "房主", status: "connected", ready: true }],
      match: { matchIndex: 0, targetWins: 2, scoreSlot1: 1, scoreSlot2: 0, roundIndex: 1, maxRounds: 9, rematchReady: [false, false] },
      round: { status: "playing", startsAt: "2026-08-06T12:00:03Z", deadline: "2026-08-06T12:15:03Z", maxGuesses: 8, self: { guesses: [] }, opponent: { rows: [] } },
      events: [event("match.started", 1, { format: "bo3", mode: "race", turnSeconds: 60, targetWins: 2, catalogVersion: "v1", matchIndex: 0 })],
    };
    const state = applySnapshot(initialRoomState, snapshot as never);
    expect(state.room?.roomCode).toBe("ABC123");
    expect(state.match?.matchIndex).toBe(0);
    expect(state.round?.status).toBe("playing");
    expect(state.lastSequence).toBe(1);
  });

  it("preserves the current sequence when a fallback snapshot has no new events", () => {
    const snapshot = {
      roomId: "room-1",
      roomCode: "ABC123",
      format: "bo3",
      mode: "race",
      turnSeconds: 60,
      status: "lobby",
      members: [
        { slot: 1, displayName: "host", status: "connected", ready: false },
      ],
      match: null,
      round: null,
      events: [],
    };
    const state = applySnapshot(
      { ...initialRoomState, lastSequence: 12 },
      snapshot as never,
    );

    expect(state.lastSequence).toBe(12);
    expect(state.room?.roomCode).toBe("ABC123");
  });
});
