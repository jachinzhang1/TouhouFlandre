import type {
  Envelope,
  MatchEndedPayload,
  MatchRematchPayload,
  MatchStartedPayload,
  MultiRoomFormat,
  MultiplayerMode,
  MultiRoomStatus,
  QuestionScopeConfig,
  RoundEndedPayload,
  RoundOpponentGuessPayload,
  RoundPlayingPayload,
  RoundSharedGuessPayload,
  RoundStartedPayload,
  RoundTurnPassPayload,
  RoundTurnTimeoutPayload,
  RoomClosedPayload,
  RoomUpdatedPayload,
} from "@touhouflandre/shared";
import type { components } from "../generated/api";

type MatchView = components["schemas"]["MatchView"];
type MemberView = components["schemas"]["MemberView"];
type RoomSnapshot = components["schemas"]["RoomSnapshot"];
type RoundView = components["schemas"]["RoundView"];

export type RoomConnection = "connecting" | "connected" | "reconnecting";

export interface RoundSummary {
  roundIndex: number;
  result: "win" | "loss" | "draw";
}

export interface RoomUiState {
  connection: RoomConnection;
  connectionIssue: string | null;
  room: {
    roomId: string;
    roomCode: string;
    format: MultiRoomFormat;
    mode: MultiplayerMode;
    turnSeconds: number;
    status: MultiRoomStatus;
  } | null;
  members: MemberView[];
  match: MatchView | null;
  round: RoundView | null;
  catalogVersion: string | null;
  questionScope: QuestionScopeConfig | null;
  roundResult: RoundEndedPayload | null;
  matchResult: MatchEndedPayload | null;
  rematchReady: [boolean, boolean];
  history: RoundSummary[];
  lastSequence: number;
}

export const initialRoomState: RoomUiState = {
  connection: "connecting",
  connectionIssue: null,
  room: null,
  members: [],
  match: null,
  round: null,
  catalogVersion: null,
  questionScope: null,
  roundResult: null,
  matchResult: null,
  rematchReady: [false, false],
  history: [],
  lastSequence: 0,
};

function roundSummary(result: string): "win" | "loss" | "draw" {
  if (result === "win" || result === "loss" || result === "draw") return result;
  return "draw";
}

export function roomReducer(state: RoomUiState, event: Envelope): RoomUiState {
  switch (event.type) {
    case "room.updated": {
      const payload = event.payload as unknown as RoomUpdatedPayload;
      return {
        ...state,
        members: payload.members,
        room: state.room
          ? {
              ...state.room,
              format: payload.format,
              mode: payload.mode,
              turnSeconds: payload.turnSeconds,
            }
          : state.room,
      };
    }
    case "match.started": {
      const payload = event.payload as unknown as MatchStartedPayload;
      return {
        ...state,
        catalogVersion: payload.catalogVersion ?? null,
        questionScope: payload.questionScope ?? state.questionScope,
        room: state.room
          ? {
              ...state.room,
              status: "playing",
              mode: payload.mode,
              turnSeconds: payload.turnSeconds,
            }
          : state.room,
        match: {
          matchIndex: payload.matchIndex,
          targetWins: payload.targetWins,
          scoreSlot1: 0,
          scoreSlot2: 0,
          roundIndex: 0,
          maxRounds: maxRoundsFor(payload.format),
          rematchReady: [false, false],
          catalogVersion: payload.catalogVersion,
        },
        round: null,
        roundResult: null,
        matchResult: null,
        rematchReady: [false, false],
        history: [],
      };
    }
    case "match.rematch": {
      const payload = event.payload as unknown as MatchRematchPayload;
      const rematchReady: [boolean, boolean] = [...state.rematchReady];
      rematchReady[payload.memberSlot - 1] = true;
      return { ...state, rematchReady };
    }
    case "round.started": {
      const payload = event.payload as unknown as RoundStartedPayload;
      return {
        ...state,
        round: {
          status: "countdown",
          startsAt: payload.startsAt,
          deadline: payload.deadline,
          maxGuesses: payload.maxGuesses,
          maxTurnsPerPlayer: payload.maxTurnsPerPlayer,
          maxSkipsPerPlayer: payload.maxSkipsPerPlayer,
          turnSlot: payload.turnSlot,
          turnDeadline: payload.turnDeadline,
          self: { guesses: [] },
          opponent: { rows: [] },
          ...(payload.maxTurnsPerPlayer ? { shared: { rows: [] } } : {}),
        },
        match: state.match
          ? { ...state.match, roundIndex: payload.roundIndex }
          : state.match,
      };
    }
    case "round.playing": {
      const _ = event.payload as unknown as RoundPlayingPayload;
      return {
        ...state,
        round: state.round
          ? { ...state.round, status: "playing" }
          : state.round,
        roundResult: null,
      };
    }
    case "round.opponent.guess": {
      const payload = event.payload as unknown as RoundOpponentGuessPayload;
      if (!state.round) return state;
      return {
        ...state,
        round: {
          ...state.round,
          opponent: {
            ...state.round.opponent,
            rows: [
              ...state.round.opponent.rows,
              { index: payload.rowIndex, statuses: payload.statuses },
            ],
          },
        },
      };
    }
    case "round.shared.guess": {
      const payload = event.payload as unknown as RoundSharedGuessPayload;
      if (!state.round) return state;
      return {
        ...state,
        round: {
          ...state.round,
          shared: {
            rows: [...(state.round.shared?.rows ?? []), payload.row],
          },
          turnSlot: payload.nextTurnSlot,
          turnDeadline: payload.nextTurnDeadline,
        },
      };
    }
    case "round.turn.timeout": {
      const payload = event.payload as unknown as RoundTurnTimeoutPayload;
      if (!state.round) return state;
      return {
        ...state,
        round: {
          ...state.round,
          shared: {
            rows: [...(state.round.shared?.rows ?? []), payload.row],
          },
          turnSlot: payload.nextTurnSlot,
          turnDeadline: payload.nextTurnDeadline,
        },
      };
    }
    case "round.turn.pass": {
      const payload = event.payload as unknown as RoundTurnPassPayload;
      if (!state.round) return state;
      return {
        ...state,
        round: {
          ...state.round,
          shared: {
            rows: [...(state.round.shared?.rows ?? []), payload.row],
          },
          turnSlot: payload.nextTurnSlot,
          turnDeadline: payload.nextTurnDeadline,
        },
      };
    }
    case "round.ended": {
      const payload = event.payload as unknown as RoundEndedPayload;
      return {
        ...state,
        round: state.round
          ? {
              ...state.round,
              status: "ended",
              ...(payload.turns ? { shared: { rows: payload.turns } } : {}),
              turnSlot: undefined,
              turnDeadline: undefined,
            }
          : state.round,
        roundResult: payload,
        history: [
          ...state.history,
          {
            roundIndex: payload.roundIndex,
            result: roundSummary(payload.result),
          },
        ],
        match: state.match
          ? {
              ...state.match,
              scoreSlot1: payload.scores.slot1,
              scoreSlot2: payload.scores.slot2,
            }
          : state.match,
      };
    }
    case "match.ended": {
      const payload = event.payload as unknown as MatchEndedPayload;
      return {
        ...state,
        matchResult: payload,
        match: state.match
          ? {
              ...state.match,
              scoreSlot1: payload.scores.slot1,
              scoreSlot2: payload.scores.slot2,
            }
          : state.match,
        room: state.room ? { ...state.room, status: "finished" } : state.room,
      };
    }
    case "room.closed": {
      const _ = event.payload as unknown as RoomClosedPayload;
      return {
        ...state,
        room: state.room ? { ...state.room, status: "closed" } : state.room,
      };
    }
    default:
      return state;
  }
}

export function maxRoundsFor(format: MultiRoomFormat): number {
  const rounds =
    format === "bo1" ? 1 : format === "bo3" ? 3 : format === "bo5" ? 5 : 7;
  return 3 * rounds;
}

export function applySnapshot(
  state: RoomUiState,
  snapshot: RoomSnapshot,
): RoomUiState {
  let next: RoomUiState = { ...state };
  for (const event of snapshot.events) {
    if (event.sequence <= next.lastSequence) continue;
    next = roomReducer(next, event);
    next.lastSequence = event.sequence;
  }
  return {
    ...next,
    room: {
      roomId: snapshot.roomId,
      roomCode: snapshot.roomCode,
      format: snapshot.format,
      mode: snapshot.mode,
      turnSeconds: snapshot.turnSeconds,
      status: snapshot.status,
    },
    members: snapshot.members,
    match: snapshot.match ?? null,
    catalogVersion: snapshot.match?.catalogVersion ?? next.catalogVersion,
    questionScope: (snapshot.match?.questionScope ??
      snapshot.questionScope ??
      next.questionScope) as QuestionScopeConfig | null,
    round: snapshot.round ?? null,
    rematchReady: snapshot.match
      ? [
          snapshot.match.rematchReady[0] ?? false,
          snapshot.match.rematchReady[1] ?? false,
        ]
      : [false, false],
  };
}
