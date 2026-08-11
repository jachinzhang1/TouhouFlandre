import type { PublicGameSession, SinglePlayerGameMode } from "@touhouflandre/shared";
import { putStatsDraft, putStatsRecord, stableRecordId, statsDb } from "./db";
import { STATS_SCHEMA_VERSION, workCode, type SingleStatsDraft, type StatsDifficulty, type StatsOutcome } from "./types";

function guessDurations(completed: number[], count: number): (number | undefined)[] {
  return Array.from({ length: count }, (_, index) => {
    const current = completed[index];
    const previous = index === 0 ? 0 : completed[index - 1];
    return Number.isFinite(current) && Number.isFinite(previous) ? Math.max(0, current - previous) : undefined;
  });
}

export async function loadSingleStatsDraft(sessionId: string): Promise<SingleStatsDraft | undefined> {
  const id = await stableRecordId(`single:${sessionId}`);
  const draft = await statsDb.drafts.get(id);
  return draft?.kind === "single" ? draft : undefined;
}

export async function saveSingleStatsDraft(
  session: PublicGameSession,
  mode: SinglePlayerGameMode,
  activeElapsedMs: number,
  guessCompletedElapsedMs: number[],
): Promise<void> {
  const id = await stableRecordId(`single:${session.id}`);
  await putStatsDraft({
    id,
    kind: "single",
    sourceKey: id,
    startedAt: session.startedAt,
    updatedAt: new Date().toISOString(),
    mode,
    difficulty: session.questionScope?.difficulty ?? "unknown",
    activeElapsedMs,
    guessCompletedElapsedMs,
  });
}

export async function recordSingleSession(
  session: PublicGameSession,
  mode: SinglePlayerGameMode,
  activeElapsedMs: number,
  guessCompletedElapsedMs: number[],
  outcomeOverride?: Extract<StatsOutcome, "forfeit" | "abandoned">,
): Promise<boolean> {
  if (!session.answer || session.status === "playing") return false;
  const id = await stableRecordId(`single:${session.id}`);
  const endedAt = session.endedAt ?? new Date().toISOString();
  const durations = guessDurations(guessCompletedElapsedMs, session.guesses.length);
  const result: "win" | "loss" = session.status === "won" ? "win" : "loss";
  const difficulty: StatsDifficulty = session.questionScope?.difficulty ?? "unknown";
  const answer = {
    id: session.answer.id,
    name: session.answer.names.zhHans,
    avatarUrl: session.answer.avatarUrl,
    work: {
      id: session.answer.firstAppearance.workId,
      title: session.answer.firstAppearance.workTitle,
      code: workCode(session.answer.firstAppearance.mainlineIndex),
    },
  };
  const record = {
    id,
    schemaVersion: STATS_SCHEMA_VERSION,
    kind: "single" as const,
    mode,
    puzzleKey: session.puzzleKey,
    startedAt: session.startedAt,
    endedAt,
    durationMs: Math.max(0, activeElapsedMs),
    outcome: (outcomeOverride ?? result) as StatsOutcome,
    difficulty,
    round: {
      roundIndex: 1,
      startedAt: session.startedAt,
      endedAt,
      durationMs: Math.max(0, activeElapsedMs),
      result,
      answer,
      guesses: session.guesses.map((guess, index) => ({
        id: guess.guessId,
        name: guess.guessName,
        avatarUrl: guess.guessAvatarUrl,
        correct: guess.isCorrect,
        durationMs: durations[index],
      })),
    },
  };
  const written = await putStatsRecord(record);
  await statsDb.drafts.delete(id);
  return written;
}
