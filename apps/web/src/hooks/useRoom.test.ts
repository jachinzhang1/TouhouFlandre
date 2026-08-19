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

const membersFixture = [
  {
    memberId: "member-host",
    seat: 1,
    displayName: "host",
    status: "connected" as const,
    ready: false,
  },
  {
    memberId: "member-guest",
    seat: 2,
    displayName: "guest",
    status: "connected" as const,
    ready: false,
  },
];

const scoresFixture = [
  { memberId: "member-host", seat: 1, score: 0 },
  { memberId: "member-guest", seat: 2, score: 0 },
];

const playerState = (): RoomUiState => ({
  ...initialRoomState,
  viewer: {
    memberId: "member-host",
    role: "player",
    seat: 1,
    displayName: "host",
    status: "connected",
  },
  members: membersFixture,
});

const roomFixture = (
  status: NonNullable<RoomUiState["room"]>["status"] = "playing",
): NonNullable<RoomUiState["room"]> => ({
  roomId: "room-1",
  roomCode: "ABC123",
  format: "bo3",
  mode: "race",
  turnSeconds: 60,
  playerLimit: 2,
  raceEliminationEnabled: false,
  minPlayers: 2,
  playerCount: 2,
  availableSeats: 0,
  status,
  expiresAt: "2026-08-06T12:30:00Z",
  spectatorCount: 0,
});

const matchFixture: NonNullable<RoomUiState["match"]> = {
  matchIndex: 0,
  targetWins: 2,
  scores: scoresFixture,
  roundIndex: 1,
  maxRounds: 9,
  rematchReady: membersFixture.map((member) => ({
    memberId: member.memberId,
    seat: member.seat,
    ready: false,
  })),
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
  it("keeps N-player identity associations stable across seat compaction", () => {
    const members = Array.from({ length: 4 }, (_, index) => ({
      memberId: `member-${index + 1}`,
      seat: index + 1,
      displayName: `player ${index + 1}`,
      status: "connected" as const,
      ready: false,
    }));
    let state: RoomUiState = {
      ...initialRoomState,
      viewer: {
        memberId: "member-4",
        role: "player",
        seat: 4,
        displayName: "player 4",
        status: "connected",
      },
      members,
      rematchReady: members.map((member) => ({
        memberId: member.memberId,
        seat: member.seat,
        ready: false,
      })),
    };
    state = roomReducer(
      state,
      event("match.rematch", 1, { memberId: "member-4", seat: 4 }),
    );
    state = roomReducer(
      state,
      event("room.updated", 2, {
        format: "bo3",
        mode: "race",
        turnSeconds: 60,
        playerLimit: 4,
        minPlayers: 2,
        playerCount: 3,
        availableSeats: 1,
        spectatorCount: 0,
        members: [
          members[0],
          { ...members[2], seat: 2 },
          { ...members[3], seat: 3 },
        ],
      }),
    );
    expect(
      state.members.find((member) => member.memberId === "member-4")?.seat,
    ).toBe(3);
    expect(
      state.rematchReady.find((member) => member.memberId === "member-4")
        ?.ready,
    ).toBe(true);
  });

  it.each([3, 4, 8])("builds a %i-player race round", (count) => {
    const members = Array.from({ length: count }, (_, index) => ({
      memberId: `member-${index + 1}`,
      seat: index + 1,
      displayName: `player ${index + 1}`,
      status: "connected" as const,
      ready: true,
    }));
    const state = roomReducer(
      {
        ...initialRoomState,
        viewer: {
          memberId: "member-1",
          role: "player",
          seat: 1,
          displayName: "player 1",
          status: "connected",
        },
        members,
      },
      event("round.started", 1, {
        matchIndex: 0,
        roundIndex: 1,
        startsAt: "2026-08-06T12:00:03Z",
        deadline: "2026-08-06T12:15:03Z",
        maxGuesses: 8,
      }),
    );
    expect(state.round?.self.memberId).toBe("member-1");
    expect(state.round?.opponents).toHaveLength(count - 1);
    expect(state.round?.opponents.map((opponent) => opponent.memberId)).toEqual(
      members.slice(1).map((member) => member.memberId),
    );
  });

  it("updates members on room.updated", () => {
    const state = roomReducer(
      initialRoomState,
      event("room.updated", 1, {
        format: "bo3",
        mode: "race",
        turnSeconds: 60,
        playerLimit: 2,
        minPlayers: 2,
        playerCount: 1,
        availableSeats: 1,
        members: [membersFixture[0]],
        spectatorCount: 1,
      }),
    );

    expect(state.members).toHaveLength(1);
    expect(state.room).toBeNull();
  });

  it("resets score and history on match.started", () => {
    let state: RoomUiState = {
      ...playerState(),
      match: {
        ...matchFixture,
        scores: [{ ...scoresFixture[0], score: 1 }, scoresFixture[1]],
      },
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
    expect(state.match?.scores.find((score) => score.seat === 1)?.score).toBe(
      0,
    );
    expect(state.history).toHaveLength(0);
    expect(state.round).toBeNull();
  });

  it("builds rounds and clears the result once playing starts", () => {
    let state: RoomUiState = { ...playerState(), match: matchFixture };

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
        viewerResult: "win",
        winnerMemberId: "member-host",
        scores: [{ ...scoresFixture[0], score: 1 }, scoresFixture[1]],
        results: [
          { memberId: "member-host", seat: 1, result: "win" },
          { memberId: "member-guest", seat: 2, result: "loss" },
        ],
        answer: { id: "a", name: "A", avatarUrl: "" },
        boards: membersFixture.map((member) => ({
          memberId: member.memberId,
          seat: member.seat,
          guesses: [],
        })),
      }),
    );
    expect(state.roundResult?.viewerResult).toBe("win");
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
    let state: RoomUiState = { ...playerState(), match: matchFixture };

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
        memberId: "member-guest",
        seat: 2,
        rowIndex: 1,
        fieldOrder: [
          "species",
          "firstAppearance",
          "affiliations",
          "releaseYear",
          "locations",
          "hairColors",
        ],
        statuses: ["miss", "exact", "partial", "lower", "miss", "unknown"],
      }),
    );
    expect(state.round?.opponents[0]?.rows).toHaveLength(1);
    expect(state.round?.opponents[0]?.fieldOrder).toEqual([
      "species",
      "firstAppearance",
      "affiliations",
      "releaseYear",
      "locations",
      "hairColors",
    ]);

    state = roomReducer(
      state,
      event("round.ended", 6, {
        matchIndex: 0,
        roundIndex: 1,
        viewerResult: "loss",
        winnerMemberId: "member-guest",
        scores: [scoresFixture[0], { ...scoresFixture[1], score: 1 }],
        results: [
          { memberId: "member-host", seat: 1, result: "loss" },
          { memberId: "member-guest", seat: 2, result: "win" },
        ],
        answer: { id: "a", name: "A", avatarUrl: "" },
        boards: membersFixture.map((member) => ({
          memberId: member.memberId,
          seat: member.seat,
          guesses: [],
        })),
      }),
    );
    expect(state.match?.scores.find((score) => score.seat === 2)?.score).toBe(
      1,
    );
    expect(state.history[0]).toEqual({ roundIndex: 1, result: "loss" });
  });

  it("adds full spectator guess rows to both boards", () => {
    let state: RoomUiState = {
      ...initialRoomState,
      viewer: {
        memberId: "spectator",
        role: "spectator",
        displayName: "watcher",
        status: "connected",
      },
      members: membersFixture,
      match: matchFixture,
    };

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
        memberId: "member-guest",
        seat: 2,
        rowIndex: 1,
        guess: guessResult,
      }),
    );

    expect(
      state.round?.boards?.find((board) => board.seat === 1)?.guesses,
    ).toHaveLength(0);
    expect(
      state.round?.boards?.find((board) => board.seat === 2)?.guesses,
    ).toEqual([guessResult]);
  });

  it("updates relay shared rows and current turn", () => {
    let state: RoomUiState = { ...playerState(), match: matchFixture };

    state = roomReducer(
      state,
      event("round.started", 4, {
        matchIndex: 0,
        roundIndex: 1,
        startsAt: "2026-08-06T12:00:03Z",
        deadline: "2026-08-06T12:15:03Z",
        maxGuesses: 8,
        turnMemberId: "member-host",
        turnSeat: 1,
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
        row: {
          index: 1,
          memberId: "member-host",
          seat: 1,
          kind: "guess",
          guess: guessResult,
        },
        nextTurnMemberId: "member-guest",
        nextTurnSeat: 2,
        nextTurnDeadline: "2026-08-06T12:02:03Z",
      }),
    );
    expect(state.round?.shared?.rows).toHaveLength(1);
    expect(state.round?.turnSeat).toBe(2);

    state = roomReducer(
      state,
      event("round.turn.timeout", 6, {
        matchIndex: 0,
        roundIndex: 1,
        row: { index: 2, memberId: "member-guest", seat: 2, kind: "timeout" },
        nextTurnMemberId: "member-host",
        nextTurnSeat: 1,
        nextTurnDeadline: "2026-08-06T12:03:03Z",
      }),
    );
    expect(state.round?.shared?.rows).toHaveLength(2);
    expect(state.round?.turnSeat).toBe(1);

    state = roomReducer(
      state,
      event("round.turn.pass", 7, {
        matchIndex: 0,
        roundIndex: 1,
        row: { index: 3, memberId: "member-host", seat: 1, kind: "pass" },
        nextTurnMemberId: "member-guest",
        nextTurnSeat: 2,
        nextTurnDeadline: "2026-08-06T12:04:03Z",
      }),
    );
    expect(state.round?.shared?.rows).toHaveLength(3);
    expect(state.round?.shared?.rows[2]?.kind).toBe("pass");
    expect(state.round?.turnSeat).toBe(2);
  });

  it("marks the room finished on match.ended", () => {
    const existingRoundResult = {
      matchIndex: 0,
      roundIndex: 2,
      viewerResult: "win",
      winnerMemberId: "member-host",
      scores: [{ ...scoresFixture[0], score: 2 }, scoresFixture[1]],
      results: [
        { memberId: "member-host", seat: 1, result: "win" },
        { memberId: "member-guest", seat: 2, result: "loss" },
      ],
      answer: {
        id: "a",
        name: "A",
        avatarUrl: "",
        workId: "th01",
        workTitle: "TH01",
        workCode: "TH01",
      },
      boards: membersFixture.map((member) => ({
        memberId: member.memberId,
        seat: member.seat,
        guesses: [],
      })),
    };
    const state = roomReducer(
      {
        ...initialRoomState,
        room: roomFixture("playing"),
        members: membersFixture,
        viewer: playerState().viewer,
        match: {
          ...matchFixture,
          scores: [{ ...scoresFixture[0], score: 1 }, scoresFixture[1]],
          roundIndex: 2,
        },
        round: {
          status: "ended",
          startsAt: "2026-08-06T12:00:03Z",
          deadline: "2026-08-06T12:15:03Z",
          maxGuesses: 8,
          self: { guesses: [] },
          opponents: [
            {
              memberId: "member-guest",
              seat: 2,
              fieldOrder: [
                "firstAppearance",
                "releaseYear",
                "species",
                "affiliations",
                "locations",
                "hairColors",
              ],
              rows: [],
            },
          ],
        },
        roundResult: existingRoundResult,
      } as RoomUiState,
      event("match.ended", 9, {
        matchIndex: 0,
        viewerResult: "win",
        winnerMemberId: "member-host",
        scores: [{ ...scoresFixture[0], score: 2 }, scoresFixture[1]],
        results: [
          { memberId: "member-host", seat: 1, result: "win" },
          { memberId: "member-guest", seat: 2, result: "loss" },
        ],
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
        rematchReady: membersFixture.map((member) => ({
          memberId: member.memberId,
          seat: member.seat,
          ready: false,
        })),
      } as RoomUiState,
      event("match.rematch", 10, { memberId: "member-guest", seat: 2 }),
    );
    expect(state.rematchReady).toEqual([
      { memberId: "member-host", seat: 1, ready: false },
      { memberId: "member-guest", seat: 2, ready: true },
    ]);

    state = roomReducer(
      state,
      event("room.closed", 11, { reason: "member_left" }),
    );
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
        playerLimit: 2,
        minPlayers: 2,
        playerCount: 0,
        availableSeats: 2,
        members: [],
        spectatorCount: 0,
      }),
      event("room.updated", 3, {
        format: "bo3",
        mode: "race",
        turnSeconds: 60,
        playerLimit: 2,
        minPlayers: 2,
        playerCount: 0,
        availableSeats: 2,
        members: [],
        spectatorCount: 0,
      }),
      event("room.updated", 5, {
        format: "bo3",
        mode: "race",
        turnSeconds: 60,
        playerLimit: 2,
        minPlayers: 2,
        playerCount: 0,
        availableSeats: 2,
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
      playerLimit: 2,
      minPlayers: 2,
      playerCount: 1,
      availableSeats: 1,
      status: "playing",
      expiresAt: "2026-08-06T12:30:00Z",
      viewer: {
        memberId: "member-host",
        role: "player",
        seat: 1,
        displayName: "host",
        status: "connected",
      },
      members: [
        {
          memberId: "member-host",
          seat: 1,
          displayName: "host",
          status: "connected",
          ready: true,
        },
      ],
      spectatorCount: 0,
      match: {
        ...matchFixture,
        scores: [{ ...scoresFixture[0], score: 1 }, scoresFixture[1]],
      },
      round: {
        status: "playing",
        startsAt: "2026-08-06T12:00:03Z",
        deadline: "2026-08-06T12:15:03Z",
        maxGuesses: 8,
        self: { memberId: "member-host", seat: 1, guesses: [] },
        opponents: [
          {
            memberId: "member-guest",
            seat: 2,
            fieldOrder: [
              "firstAppearance",
              "releaseYear",
              "species",
              "affiliations",
              "locations",
              "hairColors",
            ],
            rows: [],
          },
        ],
      },
      gameSequence: 1,
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
    expect(state.appliedGameSequence).toBe(1);
  });

  it("preserves the current sequence when a fallback snapshot has no new events", () => {
    const snapshot = {
      roomId: "room-1",
      roomCode: "ABC123",
      format: "bo3",
      mode: "race",
      turnSeconds: 60,
      playerLimit: 2,
      minPlayers: 2,
      playerCount: 1,
      availableSeats: 1,
      status: "lobby",
      expiresAt: "2026-08-06T12:30:00Z",
      viewer: {
        memberId: "member-host",
        role: "player",
        seat: 1,
        displayName: "host",
        status: "connected",
      },
      members: [
        {
          memberId: "member-host",
          seat: 1,
          displayName: "host",
          status: "connected",
          ready: false,
        },
      ],
      spectatorCount: 0,
      match: null,
      round: null,
      gameSequence: 12,
      events: [],
    };

    const state = applySnapshot(
      { ...initialRoomState, appliedGameSequence: 12 },
      snapshot as never,
    );

    expect(state.appliedGameSequence).toBe(12);
    expect(state.room?.roomCode).toBe("ABC123");
  });
});
