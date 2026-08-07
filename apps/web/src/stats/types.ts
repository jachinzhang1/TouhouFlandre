import type { MultiMatchEndReason, MultiRoomFormat } from "@touhouflandre/shared";

export const STATS_SCHEMA_VERSION = 1 as const;

export type StatsMode = "daily" | "random" | "multiplayer";
export type StatsOutcome =
  | "win"
  | "loss"
  | "draw"
  | "forfeit"
  | "abandoned"
  | "disconnect"
  | "incomplete";

export interface StatsWorkSnapshot {
  id: string;
  title: string;
  code: string;
}

export interface StatsCharacterSnapshot {
  id: string;
  name: string;
  avatarUrl?: string;
  work?: StatsWorkSnapshot;
}

export interface StatsGuessSnapshot extends StatsCharacterSnapshot {
  durationMs?: number;
  correct: boolean;
}

export interface StatsRound {
  roundIndex: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  result: "win" | "loss" | "draw";
  answer: StatsCharacterSnapshot;
  guesses: StatsGuessSnapshot[];
}

interface StatsRecordBase {
  id: string;
  schemaVersion: typeof STATS_SCHEMA_VERSION;
  mode: StatsMode;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  outcome: StatsOutcome;
}

export interface SingleStatsRecord extends StatsRecordBase {
  kind: "single";
  mode: "daily" | "random";
  puzzleKey?: string;
  round: StatsRound;
}

export interface MultiplayerStatsRecord extends StatsRecordBase {
  kind: "multiplayer";
  mode: "multiplayer";
  format: MultiRoomFormat;
  matchIndex: number;
  reason: MultiMatchEndReason | "incomplete";
  scoreSelf: number;
  scoreOpponent: number;
  rounds: StatsRound[];
}

export type StatsRecord = SingleStatsRecord | MultiplayerStatsRecord;

export interface SingleStatsDraft {
  id: string;
  kind: "single";
  sourceKey: string;
  startedAt: string;
  updatedAt: string;
  mode: "daily" | "random";
  activeElapsedMs: number;
  guessCompletedElapsedMs: number[];
}

export interface MultiplayerRoundDraft {
  roundIndex: number;
  startedAt: string;
  activeElapsedMs: number;
  guessCompletedElapsedMs: number[];
}

export interface MultiplayerStatsDraft {
  id: string;
  kind: "multiplayer";
  sourceKey: string;
  startedAt: string;
  updatedAt: string;
  format: MultiRoomFormat;
  matchIndex: number;
  rounds: StatsRound[];
  activeRound?: MultiplayerRoundDraft;
  incomplete?: boolean;
}

export type StatsDraft = SingleStatsDraft | MultiplayerStatsDraft;

export interface StatsMetadata {
  key: "schemaVersion" | "clearedAt" | "lastImportAt";
  value: number | string;
}

export interface StatsExportFile {
  schemaVersion: typeof STATS_SCHEMA_VERSION;
  exportedAt: string;
  records: StatsRecord[];
}

export interface StatsFilters {
  mode: "all" | StatsMode;
  from?: string;
  to?: string;
  format: "all" | MultiRoomFormat;
}

export function workCode(mainlineIndex?: number, fallback = "TH--"): string {
  if (!Number.isFinite(mainlineIndex)) return fallback;
  return `TH${String(mainlineIndex).padStart(2, "0")}`;
}

