import type {
  Envelope,
  MatchEndedPayload,
  MatchStartedPayload,
  RoundEndedPayload,
  RoundStartedPayload,
} from "@touhouflandre/shared";
import { putStatsDraft, stableRecordId, statsDb } from "./db";
import {
  STATS_SCHEMA_VERSION,
  type MultiplayerStatsDraft,
  type StatsGuessSnapshot,
  type StatsOutcome,
  type StatsRelayTurnSnapshot,
} from "./types";

export interface MultiplayerTimingSnapshot {
  activeElapsedMs: number;
  guessCompletedElapsedMs: number[];
}

function durationsForGuesses(completed: number[], count: number): (number | undefined)[] {
  return Array.from({ length: count }, (_, index) => {
    const current = completed[index];
    const previous = index === 0 ? 0 : completed[index - 1];
    return Number.isFinite(current) && Number.isFinite(previous) ? Math.max(0, current - previous) : undefined;
  });
}

async function draftId(roomId: string, matchIndex: number, mySlot: 1 | 2): Promise<string> {
  return stableRecordId(`multi:${roomId}:${matchIndex}:${mySlot}`);
}

async function roomSourceKey(roomId: string, mySlot: 1 | 2): Promise<string> {
  return stableRecordId(`multi-room:${roomId}:${mySlot}`);
}

function outcomeForMatch(payload: MatchEndedPayload): StatsOutcome {
  if (payload.result === "win") return "win";
  if (payload.result === "draw") return "draw";
  if (payload.reason === "forfeit") return "forfeit";
  if (payload.reason === "disconnect") return "disconnect";
  return "loss";
}

export async function recordMultiplayerEvent(
  event: Envelope,
  mySlot: 1 | 2,
  timing?: MultiplayerTimingSnapshot,
): Promise<void> {
  if (event.type === "match.started") {
    const payload = event.payload as unknown as MatchStartedPayload;
    const id = await draftId(event.roomId, payload.matchIndex, mySlot);
    if (await statsDb.records.get(id)) return;
    const existing = await statsDb.drafts.get(id);
    if (existing) return;
    await putStatsDraft({
      id,
      kind: "multiplayer",
      sourceKey: await roomSourceKey(event.roomId, mySlot),
      startedAt: event.occurredAt,
      updatedAt: event.occurredAt,
      format: payload.format,
      multiplayerMode: payload.mode ?? "race",
      memberSlot: mySlot,
      matchIndex: payload.matchIndex,
      rounds: [],
    });
    return;
  }

  if (event.type === "round.started") {
    const payload = event.payload as unknown as RoundStartedPayload;
    const id = await draftId(event.roomId, payload.matchIndex, mySlot);
    const draft = await statsDb.drafts.get(id);
    if (!draft || draft.kind !== "multiplayer") return;
    draft.activeRound = {
      roundIndex: payload.roundIndex,
      startedAt: payload.startsAt,
      activeElapsedMs: 0,
      guessCompletedElapsedMs: [],
    };
    draft.updatedAt = event.occurredAt;
    await putStatsDraft(draft);
    return;
  }

  if (event.type === "round.ended") {
    const payload = event.payload as unknown as RoundEndedPayload;
    const id = await draftId(event.roomId, payload.matchIndex, mySlot);
    const draft = await statsDb.drafts.get(id);
    if (!draft || draft.kind !== "multiplayer") return;
    const active = draft.activeRound?.roundIndex === payload.roundIndex ? draft.activeRound : undefined;
    const elapsed = Math.max(0, timing?.activeElapsedMs ?? 0, active?.activeElapsedMs ?? 0);
    const completed =
      (timing?.guessCompletedElapsedMs.length ?? 0) >= (active?.guessCompletedElapsedMs.length ?? 0)
        ? timing?.guessCompletedElapsedMs ?? []
        : active?.guessCompletedElapsedMs ?? [];
    const multiplayerMode = draft.multiplayerMode ?? "race";
    const board = mySlot === 1 ? payload.boards.slot1 : payload.boards.slot2;
    const durations = durationsForGuesses(completed, board.length);
    let turns: StatsRelayTurnSnapshot[] | undefined;
    let guesses: StatsGuessSnapshot[];
    if (multiplayerMode === "relay" && payload.turns) {
      turns = payload.turns.map((turn) => {
        const memberSlot = turn.memberSlot === 2 ? 2 : 1;
        if (turn.kind !== "guess" || !turn.guess) {
          return {
            index: turn.index,
            memberSlot,
            kind: turn.kind === "pass" ? "pass" : "timeout",
          };
        }
        return {
          index: turn.index,
          memberSlot,
          kind: "guess",
          guess: {
            id: turn.guess.guessId,
            name: turn.guess.guessName,
            avatarUrl: turn.guess.guessAvatarUrl,
            correct: turn.guess.isCorrect,
            memberSlot,
          },
        };
      });
      guesses = turns.flatMap((turn) =>
        turn.kind === "guess" ? [turn.guess] : [],
      );
    } else {
      guesses = board.map((guess, index) => ({
        id: guess.guessId,
        name: guess.guessName,
        avatarUrl: guess.guessAvatarUrl,
        correct: guess.isCorrect,
        durationMs: durations[index],
      }));
    }
    const round = {
      roundIndex: payload.roundIndex,
      startedAt: active?.startedAt ?? event.occurredAt,
      endedAt: event.occurredAt,
      durationMs: elapsed,
      result: payload.result,
      answer: {
        id: payload.answer.id,
        name: payload.answer.name,
        avatarUrl: payload.answer.avatarUrl,
        work: { id: payload.answer.workId, title: payload.answer.workTitle, code: payload.answer.workCode },
      },
      guesses,
      turns,
    };
    draft.rounds = [...draft.rounds.filter((entry) => entry.roundIndex !== payload.roundIndex), round].sort((a, b) => a.roundIndex - b.roundIndex);
    draft.activeRound = undefined;
    draft.updatedAt = event.occurredAt;
    await putStatsDraft(draft);
    return;
  }

  if (event.type === "match.ended") {
    const payload = event.payload as unknown as MatchEndedPayload;
    const id = await draftId(event.roomId, payload.matchIndex, mySlot);
    const draft = await statsDb.drafts.get(id);
    if (!draft || draft.kind !== "multiplayer") return;
    const scoreSelf = mySlot === 1 ? payload.scores.slot1 : payload.scores.slot2;
    const scoreOpponent = mySlot === 1 ? payload.scores.slot2 : payload.scores.slot1;
    const durationMs = draft.rounds.reduce((sum, round) => sum + round.durationMs, 0);
    const record = {
      id,
      schemaVersion: STATS_SCHEMA_VERSION,
      kind: "multiplayer" as const,
      mode: "multiplayer" as const,
      format: draft.format,
      multiplayerMode: draft.multiplayerMode ?? "race",
      memberSlot: draft.memberSlot ?? mySlot,
      matchIndex: payload.matchIndex,
      startedAt: draft.startedAt,
      endedAt: event.occurredAt,
      durationMs,
      outcome: outcomeForMatch(payload),
      reason: payload.reason,
      scoreSelf,
      scoreOpponent,
      rounds: draft.rounds,
    };
    await statsDb.transaction("rw", statsDb.records, statsDb.drafts, statsDb.metadata, async () => {
      const clearedAt = await statsDb.metadata.get("clearedAt");
      if (typeof clearedAt?.value !== "string" || Date.parse(event.occurredAt) > Date.parse(clearedAt.value)) {
        await statsDb.records.put(record);
      }
      await statsDb.drafts.delete(id);
    });
  }
}

export async function loadMultiplayerTiming(
  roomId: string,
  matchIndex: number,
  mySlot: 1 | 2,
): Promise<MultiplayerTimingSnapshot | undefined> {
  const draft = await statsDb.drafts.get(await draftId(roomId, matchIndex, mySlot));
  if (!draft || draft.kind !== "multiplayer" || !draft.activeRound) return undefined;
  return {
    activeElapsedMs: draft.activeRound.activeElapsedMs,
    guessCompletedElapsedMs: draft.activeRound.guessCompletedElapsedMs,
  };
}

export async function updateMultiplayerTiming(
  roomId: string,
  matchIndex: number,
  mySlot: 1 | 2,
  timing: MultiplayerTimingSnapshot,
): Promise<void> {
  const id = await draftId(roomId, matchIndex, mySlot);
  const draft = await statsDb.drafts.get(id);
  if (!draft || draft.kind !== "multiplayer" || !draft.activeRound) return;
  draft.activeRound.activeElapsedMs = timing.activeElapsedMs;
  draft.activeRound.guessCompletedElapsedMs = timing.guessCompletedElapsedMs;
  draft.updatedAt = new Date().toISOString();
  await putStatsDraft(draft);
}

export async function markMultiplayerDraftIncomplete(roomId: string, mySlot: 1 | 2): Promise<void> {
  const sourceKey = await roomSourceKey(roomId, mySlot);
  const draft = (await statsDb.drafts.where("kind").equals("multiplayer").toArray()).find((entry) => entry.kind === "multiplayer" && entry.sourceKey === sourceKey) as MultiplayerStatsDraft | undefined;
  if (!draft) return;
  draft.incomplete = true;
  draft.updatedAt = new Date().toISOString();
  await putStatsDraft(draft);
}
