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

const roomFixture = (
  status: NonNullable<RoomUiState["room"]>["status"] = "playing",
): NonNullable<RoomUiState["room"]> => ({
  roomId: "room-1",
  roomCode: "ABC123",
  format: "bo3",
  mode: "race",
  turnSeconds: 60,
  status,
  expiresAt: "2026-08-06T12:30:00Z",
  spectatorCount: 0,
});

const matchFixture: NonNullable<RoomUiState["match"]> = {
  matchIndex: 0,
  targetWins: 2,
  scoreSlot1: 0,
  scoreSlot2: 0,
  roundIndex: 1,
  maxRounds: 9,
  rematchReady: [false, false],
  catalogVersion: "v1",
};

const guessResult = {
  kind: "guess",
  guessId: "a",
  guessName: "A",
  isCorrect: false,
  feedback: [],
};

describe("roomReducer", () => {
  it("updates members on room.updated", () => {
    const state = roomReducer(
      initialRoomState,
      event("room.updated", 1, {
        format: "bo3",
        mode: "race",
        turnSeconds: 60,
        members: [
          { slot: 1, displayName: "host", status: "connected", ready: false },
        ],
        spectatorCount: 1,
      }),
    );

    expect(state.members).toHaveLength(1);
    expect(state.room).toBeNull();
  });

  it("resets score and history on match.started", () => {
    let state: RoomUiState = {
      ...initialRoomState,
      match: { ...matchFixture, scoreSlot1: 1 },
      history: [{ roundIndex: 1, result: "win" }],
    };

    state = roomReducer(
      state,
      event("match.started", 3, {
        format: "bo3",
        mode: "race",
        turnSeconds: 60,
        targetWins: 2,
        catalogVersion: "v1",
        matchIndex: 1,
      }),
    );

    expect(state.match?.matchIndex).toBe(1);
    expect(state.match?.scoreSlot1).toBe(0);
    expect(state.history).toHaveLength(0);
    expect(state.round).toBeNull();
  });

  it("builds rounds and clears the result once playing starts", () => {
    let state: RoomUiState = { ...initialRoomState, match: matchFixture };

    state = roomReducer(
      state,
      event("round.started", 4, {
        matchIndex: 0,
        roundIndex: 1,
        startsAt: "2026-08-06T12:00:03Z",
        deadline: "2026-08-06T12:15:03Z",
        maxGuesses: 8,
      }),
    );
    expect(state.round?.status).toBe("countdown");

    state = roomReducer(
      state,
      event("round.ended", 5, {
        matchIndex: 0,
        roundIndex: 1,
        result: "win",
        winnerSlot: 1,
        scores: { slot1: 1, slot2: 0 },
        answer: { id: "a", name: "A", avatarUrl: "" },
        boards: { slot1: [], slot2: [] },
      }),
    );
    expect(state.roundResult?.result).toBe("win");
    expect(state.roundArchives).toHaveLength(1);

    state = roomReducer(
      state,
      event("round.started", 6, {
        matchIndex: 0,
        roundIndex: 2,
        startsAt: "2026-08-06T12:00:08Z",
        deadline: "2026-08-06T12:15:08Z",
        maxGuesses: 8,
      }),
    );
    expect(state.roundResult).not.toBeNull();
    expect(state.round?.status).toBe("countdown");

    state = roomReducer(
      state,
      event("round.playing", 7, { matchIndex: 0, roundIndex: 2 }),
    );
    expect(state.roundResult).toBeNull();
    expect(state.round?.status).toBe("playing");
  });

  it("updates opponent rows, score, and history", () => {
    let state: RoomUiState = { ...initialRoomState, match: matchFixture };

    state = roomReducer(
      state,
      event("round.started", 4, {
        matchIndex: 0,
        roundIndex: 1,
        startsAt: "2026-08-06T12:00:03Z",
        deadline: "2026-08-06T12:15:03Z",
        maxGuesses: 8,
      }),
    );
    state = roomReducer(
      state,
      event("round.opponent.guess", 5, {
        matchIndex: 0,
        roundIndex: 1,
        rowIndex: 1,
        statuses: ["miss", "exact", "partial", "lower", "miss", "unknown"],
      }),
    );
    expect(state.round?.opponent.rows).toHaveLength(1);

    state = roomReducer(
      state,
      event("round.ended", 6, {
        matchIndex: 0,
        roundIndex: 1,
        result: "loss",
        winnerSlot: 2,
        scores: { slot1: 0, slot2: 1 },
        answer: { id: "a", name: "A", avatarUrl: "" },
        boards: { slot1: [], slot2: [] },
      }),
    );
    expect(state.match?.scoreSlot2).toBe(1);
    expect(state.history[0]).toEqual({ roundIndex: 1, result: "loss" });
  });

  it("adds full spectator guess rows to both boards", () => {
    let state: RoomUiState = { ...initialRoomState, match: matchFixture };

    state = roomReducer(
      state,
      event("round.started", 4, {
        matchIndex: 0,
        roundIndex: 1,
        startsAt: "2026-08-06T12:00:03Z",
        deadline: "2026-08-06T12:15:03Z",
        maxGuesses: 8,
      }),
    );
    state = roomReducer(
      state,
      event("round.spectator.guess", 5, {
        matchIndex: 0,
        roundIndex: 1,
        memberSlot: 2,
        rowIndex: 1,
        guess: guessResult,
      }),
    );

    expect(state.round?.boards?.slot1).toHaveLength(0);
    expect(state.round?.boards?.slot2).toEqual([guessResult]);
  });

  it("updates relay shared rows and current turn", () => {
    let state: RoomUiState = { ...initialRoomState, match: matchFixture };

    state = roomReducer(
      state,
      event("round.started", 4, {
        matchIndex: 0,
        roundIndex: 1,
        startsAt: "2026-08-06T12:00:03Z",
        deadline: "2026-08-06T12:15:03Z",
        maxGuesses: 8,
        turnSlot: 1,
        turnDeadline: "2026-08-06T12:01:03Z",
        maxTurnsPerPlayer: 8,
        maxSkipsPerPlayer: 2,
      }),
    );
    expect(state.round?.maxSkipsPerPlayer).toBe(2);

    state = roomReducer(
      state,
      event("round.shared.guess", 5, {
        matchIndex: 0,
        roundIndex: 1,
        row: { index: 1, memberSlot: 1, kind: "guess", guess: guessResult },
        nextTurnSlot: 2,
        nextTurnDeadline: "2026-08-06T12:02:03Z",
      }),
    );
    expect(state.round?.shared?.rows).toHaveLength(1);
    expect(state.round?.turnSlot).toBe(2);

    state = roomReducer(
      state,
      event("round.turn.timeout", 6, {
        matchIndex: 0,
        roundIndex: 1,
        row: { index: 2, memberSlot: 2, kind: "timeout" },
        nextTurnSlot: 1,
        nextTurnDeadline: "2026-08-06T12:03:03Z",
      }),
    );
    expect(state.round?.shared?.rows).toHaveLength(2);
    expect(state.round?.turnSlot).toBe(1);

    state = roomReducer(
      state,
      event("round.turn.pass", 7, {
        matchIndex: 0,
        roundIndex: 1,
        row: { index: 3, memberSlot: 1, kind: "pass" },
        nextTurnSlot: 2,
        nextTurnDeadline: "2026-08-06T12:04:03Z",
      }),
    );
    expect(state.round?.shared?.rows).toHaveLength(3);
    expect(state.round?.shared?.rows[2]?.kind).toBe("pass");
    expect(state.round?.turnSlot).toBe(2);
  });

  it("marks the room finished on match.ended", () => {
    const existingRoundResult = {
      matchIndex: 0,
      roundIndex: 2,
      result: "win",
      winnerSlot: 1,
      scores: { slot1: 2, slot2: 0 },
      answer: {
        id: "a",
        name: "A",
        avatarUrl: "",
        workId: "th01",
        workTitle: "TH01",
        workCode: "TH01",
      },
      boards: { slot1: [], slot2: [] },
    };
    const state = roomReducer(
      {
        ...initialRoomState,
        room: roomFixture("playing"),
        match: { ...matchFixture, scoreSlot1: 1, roundIndex: 2 },
        round: {
          status: "ended",
          startsAt: "2026-08-06T12:00:03Z",
          deadline: "2026-08-06T12:15:03Z",
          maxGuesses: 8,
          self: { guesses: [] },
          opponent: { rows: [] },
        },
        roundResult: existingRoundResult,
      } as RoomUiState,
      event("match.ended", 9, {
        matchIndex: 0,
        result: "win",
        winnerSlot: 1,
        scores: { slot1: 2, slot2: 0 },
        reason: "normal",
        retentionEndsAt: "2026-08-06T12:30:00Z",
      }),
    );

    expect(state.matchResult?.reason).toBe("normal");
    expect(state.roundResult?.answer.name).toBe("A");
    expect(state.round?.status).toBe("ended");
    expect(state.room?.status).toBe("finished");
    expect(state.room?.expiresAt).toBe("2026-08-06T12:30:00Z");
  });

  it("marks rematch and closes the room", () => {
    let state = roomReducer(
      {
        ...initialRoomState,
        room: roomFixture("finished"),
        rematchReady: [false, false],
      } as RoomUiState,
      event("match.rematch", 10, { memberSlot: 2 }),
    );
    expect(state.rematchReady).toEqual([false, true]);

    state = roomReducer(state, event("room.closed", 11, { reason: "member_left" }));
    expect(state.room?.status).toBe("closed");
  });

  it("deduplicates by sequence", () => {
    let applied = 0;
    let state = initialRoomState;
    for (const e of [
      event("room.updated", 5, {
        format: "bo3",
        mode: "race",
        turnSeconds: 60,
        members: [],
        spectatorCount: 0,
      }),
      event("room.updated", 3, {
        format: "bo3",
        mode: "race",
        turnSeconds: 60,
        members: [],
        spectatorCount: 0,
      }),
      event("room.updated", 5, {
        format: "bo3",
        mode: "race",
        turnSeconds: 60,
        members: [],
        spectatorCount: 0,
      }),
    ]) {
      if (e.sequence <= applied) continue;
      applied = e.sequence;
      state = roomReducer(state, e);
    }
    expect(applied).toBe(5);
    expect(state.members).toHaveLength(0);
  });
});

describe("applySnapshot", () => {
  it("applies snapshot state and replays events", () => {
    const snapshot = {
      roomId: "room-1",
      roomCode: "ABC123",
      format: "bo3",
      mode: "race",
      turnSeconds: 60,
      status: "playing",
      expiresAt: "2026-08-06T12:30:00Z",
      viewer: {
        role: "player",
        slot: 1,
        displayName: "host",
        status: "connected",
      },
      members: [
        { slot: 1, displayName: "host", status: "connected", ready: true },
      ],
      spectatorCount: 0,
      match: {
        ...matchFixture,
        scoreSlot1: 1,
      },
      round: {
        status: "playing",
        startsAt: "2026-08-06T12:00:03Z",
        deadline: "2026-08-06T12:15:03Z",
        maxGuesses: 8,
        self: { guesses: [] },
        opponent: { rows: [] },
      },
      events: [
        event("match.started", 1, {
          format: "bo3",
          mode: "race",
          turnSeconds: 60,
          targetWins: 2,
          catalogVersion: "v1",
          matchIndex: 0,
        }),
      ],
    };

    const state = applySnapshot(initialRoomState, snapshot as never);
    expect(state.room?.roomCode).toBe("ABC123");
    expect(state.viewer?.role).toBe("player");
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
      expiresAt: "2026-08-06T12:30:00Z",
      viewer: {
        role: "player",
        slot: 1,
        displayName: "host",
        status: "connected",
      },
      members: [
        { slot: 1, displayName: "host", status: "connected", ready: false },
      ],
      spectatorCount: 0,
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
