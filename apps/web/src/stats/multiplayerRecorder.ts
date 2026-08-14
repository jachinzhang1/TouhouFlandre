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
import {
  boardForMemberId,
  resultForMemberId,
  scoreForMemberId,
} from "../domain/memberCollections";
import { assertStatsPrivacy } from "./privacy";

export interface MultiplayerTimingSnapshot {
  activeElapsedMs: number;
  guessCompletedElapsedMs: number[];
}

export interface MultiplayerRoomContext {
  playerLimit?: number;
}

function durationsForGuesses(
  completed: number[],
  count: number,
): (number | undefined)[] {
  return Array.from({ length: count }, (_, index) => {
    const current = completed[index];
    const previous = index === 0 ? 0 : completed[index - 1];
    return Number.isFinite(current) && Number.isFinite(previous)
      ? Math.max(0, current - previous)
      : undefined;
  });
}

async function draftId(
  roomId: string,
  matchIndex: number,
  viewerMemberId: string,
): Promise<string> {
  return stableRecordId(`multi:${roomId}:${matchIndex}:${viewerMemberId}`);
}

async function roomSourceKey(
  roomId: string,
  viewerMemberId: string,
): Promise<string> {
  return stableRecordId(`multi-room:${roomId}:${viewerMemberId}`);
}

function outcomeForMatch(
  payload: MatchEndedPayload,
  viewerMemberId: string,
): StatsOutcome {
  const result =
    payload.viewerResult ??
    resultForMemberId(payload.results, viewerMemberId) ??
    "draw";
  if (result === "win") return "win";
  if (result === "draw") return "draw";
  if (payload.reason === "forfeit") return "forfeit";
  if (payload.reason === "disconnect") return "disconnect";
  return "loss";
}

export async function recordMultiplayerEvent(
  event: Envelope,
  viewerMemberId: string,
  timing?: MultiplayerTimingSnapshot,
  context?: MultiplayerRoomContext,
): Promise<void> {
  const identity = viewerMemberId;
  if (event.type === "match.started") {
    const payload = event.payload as unknown as MatchStartedPayload;
    const id = await draftId(event.roomId, payload.matchIndex, identity);
    if (await statsDb.records.get(id)) return;
    const existing = await statsDb.drafts.get(id);
    if (existing) return;
    await putStatsDraft({
      id,
      kind: "multiplayer",
      sourceKey: await roomSourceKey(event.roomId, identity),
      startedAt: event.occurredAt,
      updatedAt: event.occurredAt,
      format: payload.format,
      multiplayerMode: payload.mode ?? "race",
      difficulty: payload.questionScope?.difficulty ?? "unknown",
      matchIndex: payload.matchIndex,
      playerLimit: context?.playerLimit,
      rounds: [],
    });
    return;
  }

  if (event.type === "round.started") {
    const payload = event.payload as unknown as RoundStartedPayload;
    const id = await draftId(event.roomId, payload.matchIndex, viewerMemberId);
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
    const id = await draftId(event.roomId, payload.matchIndex, viewerMemberId);
    const draft = await statsDb.drafts.get(id);
    if (!draft || draft.kind !== "multiplayer") return;
    const active =
      draft.activeRound?.roundIndex === payload.roundIndex
        ? draft.activeRound
        : undefined;
    const elapsed = Math.max(
      0,
      timing?.activeElapsedMs ?? 0,
      active?.activeElapsedMs ?? 0,
    );
    const completed =
      (timing?.guessCompletedElapsedMs.length ?? 0) >=
      (active?.guessCompletedElapsedMs.length ?? 0)
        ? (timing?.guessCompletedElapsedMs ?? [])
        : (active?.guessCompletedElapsedMs ?? []);
    const multiplayerMode = draft.multiplayerMode ?? "race";
    const board = boardForMemberId(payload.boards, identity);
    const durations = durationsForGuesses(completed, board.length);
    let turns: StatsRelayTurnSnapshot[] | undefined;
    let guesses: StatsGuessSnapshot[];
    if (multiplayerMode === "relay" && payload.turns) {
      turns = payload.turns.map((turn) => {
        const actor = turn.memberId === identity ? "self" : "other";
        if (turn.kind !== "guess" || !turn.guess) {
          return {
            index: turn.index,
            actor,
            kind: turn.kind === "pass" ? "pass" : "timeout",
          };
        }
        return {
          index: turn.index,
          actor,
          kind: "guess",
          guess: {
            id: turn.guess.guessId,
            name: turn.guess.guessName,
            avatarUrl: turn.guess.guessAvatarUrl,
            correct: turn.guess.isCorrect,
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
      result:
        payload.viewerResult ??
        resultForMemberId(payload.results, identity) ??
        "draw",
      answer: {
        id: payload.answer.id,
        name: payload.answer.name,
        avatarUrl: payload.answer.avatarUrl,
        work: {
          id: payload.answer.workId,
          title: payload.answer.workTitle,
          code: payload.answer.workCode,
        },
      },
      guesses,
      turns,
    };
    draft.rounds = [
      ...draft.rounds.filter(
        (entry) => entry.roundIndex !== payload.roundIndex,
      ),
      round,
    ].sort((a, b) => a.roundIndex - b.roundIndex);
    draft.activeRound = undefined;
    draft.updatedAt = event.occurredAt;
    await putStatsDraft(draft);
    return;
  }

  if (event.type === "match.ended") {
    const payload = event.payload as unknown as MatchEndedPayload;
    const id = await draftId(event.roomId, payload.matchIndex, viewerMemberId);
    const draft = await statsDb.drafts.get(id);
    if (!draft || draft.kind !== "multiplayer") return;
    const scoreSelf = scoreForMemberId(payload.scores, identity);
    const opponentScores = payload.scores
      .filter((score) => score.memberId !== identity)
      .sort((a, b) => a.seat - b.seat)
      .map((score) => score.score);
    const durationMs = draft.rounds.reduce(
      (sum, round) => sum + round.durationMs,
      0,
    );
    const record = {
      id,
      schemaVersion: STATS_SCHEMA_VERSION,
      kind: "multiplayer" as const,
      mode: "multiplayer" as const,
      format: draft.format,
      multiplayerMode: draft.multiplayerMode ?? "race",
      matchIndex: payload.matchIndex,
      startedAt: draft.startedAt,
      endedAt: event.occurredAt,
      durationMs,
      outcome: outcomeForMatch(payload, viewerMemberId),
      difficulty: draft.difficulty ?? "unknown",
      reason: payload.reason,
      scoreSelf,
      opponentScores,
      rosterSize: payload.scores.length,
      playerLimit: draft.playerLimit ?? payload.scores.length,
      rounds: draft.rounds,
    };
    assertStatsPrivacy(record);
    await statsDb.transaction(
      "rw",
      statsDb.records,
      statsDb.drafts,
      statsDb.metadata,
      async () => {
        const clearedAt = await statsDb.metadata.get("clearedAt");
        if (
          typeof clearedAt?.value !== "string" ||
          Date.parse(event.occurredAt) > Date.parse(clearedAt.value)
        ) {
          await statsDb.records.put(record);
        }
        await statsDb.drafts.delete(id);
      },
    );
  }
}

export async function migrateLegacyMultiplayerDraft(
  roomId: string,
  matchIndex: number,
  legacySeat: 1 | 2,
  viewerMemberId: string,
): Promise<void> {
  const oldId = await stableRecordId(
    `multi:${roomId}:${matchIndex}:${legacySeat}`,
  );
  const draft = await statsDb.drafts.get(oldId);
  if (!draft || draft.kind !== "multiplayer") return;
  const id = await draftId(roomId, matchIndex, viewerMemberId);
  const current = await statsDb.drafts.get(id);
  const currentDraft = current?.kind === "multiplayer" ? current : undefined;
  const rounds = new Map(
    (currentDraft?.rounds ?? []).map((round) => [round.roundIndex, round]),
  );
  for (const round of draft.rounds) rounds.set(round.roundIndex, round);
  const currentActive = currentDraft?.activeRound;
  const legacyActive = draft.activeRound;
  const activeRound =
    currentActive &&
    legacyActive &&
    currentActive.roundIndex === legacyActive.roundIndex
      ? {
          ...currentActive,
          activeElapsedMs: Math.max(
            currentActive.activeElapsedMs,
            legacyActive.activeElapsedMs,
          ),
          guessCompletedElapsedMs:
            legacyActive.guessCompletedElapsedMs.length >=
            currentActive.guessCompletedElapsedMs.length
              ? legacyActive.guessCompletedElapsedMs
              : currentActive.guessCompletedElapsedMs,
        }
      : (legacyActive ?? currentActive);
  const migrated: MultiplayerStatsDraft = {
    ...currentDraft,
    ...draft,
    id,
    sourceKey: await roomSourceKey(roomId, viewerMemberId),
    playerLimit: currentDraft?.playerLimit ?? draft.playerLimit,
    rounds: [...rounds.values()].sort(
      (left, right) => left.roundIndex - right.roundIndex,
    ),
    activeRound,
  };
  delete migrated.memberSlot;
  await statsDb.transaction("rw", statsDb.drafts, async () => {
    await statsDb.drafts.put(migrated);
    await statsDb.drafts.delete(oldId);
  });
}

export async function loadMultiplayerTiming(
  roomId: string,
  matchIndex: number,
  viewerMemberId: string,
): Promise<MultiplayerTimingSnapshot | undefined> {
  const draft = await statsDb.drafts.get(
    await draftId(roomId, matchIndex, viewerMemberId),
  );
  if (!draft || draft.kind !== "multiplayer" || !draft.activeRound)
    return undefined;
  return {
    activeElapsedMs: draft.activeRound.activeElapsedMs,
    guessCompletedElapsedMs: draft.activeRound.guessCompletedElapsedMs,
  };
}

export async function updateMultiplayerTiming(
  roomId: string,
  matchIndex: number,
  viewerMemberId: string,
  timing: MultiplayerTimingSnapshot,
): Promise<void> {
  const id = await draftId(roomId, matchIndex, viewerMemberId);
  const draft = await statsDb.drafts.get(id);
  if (!draft || draft.kind !== "multiplayer" || !draft.activeRound) return;
  draft.activeRound.activeElapsedMs = timing.activeElapsedMs;
  draft.activeRound.guessCompletedElapsedMs = timing.guessCompletedElapsedMs;
  draft.updatedAt = new Date().toISOString();
  await putStatsDraft(draft);
}

export async function markMultiplayerDraftIncomplete(
  roomId: string,
  viewerMemberId: string,
): Promise<void> {
  const sourceKey = await roomSourceKey(roomId, viewerMemberId);
  const draft = (
    await statsDb.drafts.where("kind").equals("multiplayer").toArray()
  ).find(
    (entry) => entry.kind === "multiplayer" && entry.sourceKey === sourceKey,
  ) as MultiplayerStatsDraft | undefined;
  if (!draft) return;
  draft.incomplete = true;
  draft.updatedAt = new Date().toISOString();
  await putStatsDraft(draft);
}
