import type {
  MultiMatchEndReason,
  MultiRoomFormat,
  MultiplayerMode,
  QuestionDifficulty,
} from "@touhouflandre/shared";

export const STATS_SCHEMA_VERSION = 6 as const;

export type StatsMode = "daily" | "random" | "multiplayer";
export type StatsDifficulty = QuestionDifficulty | "unknown";
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

export type StatsRelayTurnSnapshot =
  | { index: number; actor: "self" | "other"; kind: "timeout" | "pass" }
  | {
      index: number;
      actor: "self" | "other";
      kind: "guess";
      guess: StatsGuessSnapshot;
    };

export interface StatsRound {
  roundIndex: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  result: "win" | "loss" | "draw";
  answer: StatsCharacterSnapshot;
  guesses: StatsGuessSnapshot[];
  turns?: StatsRelayTurnSnapshot[];
  pointsAwarded?: number;
  participationStatus?: "correct" | "forfeited" | "exhausted" | "timed_out";
}

export interface StatsRelayStage {
  stageIndex: number;
  assignment: "paired" | "bye";
  outcome: "win" | "loss" | "draw" | "bye";
  encounterEndReason?: "win" | "loss" | "draw" | "forfeit" | "timeout";
  scoreBefore?: number;
  scoreDelta?: number;
  scoreAfter?: number;
  lifeBefore?: "healthy" | "near_death";
  lifeAfter?: "healthy" | "near_death";
  lifeTransition?: "none" | "entered_near_death" | "eliminated";
  encounter?: StatsRound;
}

interface StatsRecordBase {
  id: string;
  schemaVersion: typeof STATS_SCHEMA_VERSION;
  mode: StatsMode;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  outcome: StatsOutcome;
  difficulty?: StatsDifficulty;
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
  multiplayerMode: MultiplayerMode;
  ruleSetKey: string;
  ruleSetVersion: number;
  matchIndex: number;
  reason: MultiMatchEndReason | "incomplete";
  scoreSelf: number;
  opponentScores: number[];
  rosterSize: number;
  playerLimit: number;
  scoringMode?: "wins" | "points" | "placement";
  finalRank?: number;
  tiedForFirst?: boolean;
  eliminatedRound?: number;
  eliminatedStage?: number;
  survivedStages?: number;
  rounds: StatsRound[];
  relayStages?: StatsRelayStage[];
}

export type StatsRecord = SingleStatsRecord | MultiplayerStatsRecord;

export interface SingleStatsDraft {
  id: string;
  kind: "single";
  sourceKey: string;
  startedAt: string;
  updatedAt: string;
  mode: "daily" | "random";
  difficulty?: StatsDifficulty;
  activeElapsedMs: number;
  guessCompletedElapsedMs: number[];
}

export interface MultiplayerRoundDraft {
  roundIndex: number;
  startedAt: string;
  activeElapsedMs: number;
  guessCompletedElapsedMs: number[];
}

export interface MultiplayerRelayStageDraft {
  stageIndex: number;
  startedAt: string;
  assignment: "paired" | "bye";
  encounterKey?: string;
  activeElapsedMs: number;
  guessCompletedElapsedMs: number[];
  turns: StatsRelayTurnSnapshot[];
  encounter?: StatsRound;
  encounterEndReason?: StatsRelayStage["encounterEndReason"];
}

export interface MultiplayerStatsDraft {
  id: string;
  kind: "multiplayer";
  sourceKey: string;
  startedAt: string;
  updatedAt: string;
  format: MultiRoomFormat;
  multiplayerMode: MultiplayerMode;
  difficulty?: StatsDifficulty;
  /** @deprecated active v3 drafts are lazily migrated after snapshot. */
  memberSlot?: 1 | 2;
  matchIndex: number;
  playerLimit?: number;
  scoringMode?: "wins" | "points" | "placement";
  ruleSetKey?: string;
  ruleSetVersion?: number;
  rosterSize?: number;
  rounds: StatsRound[];
  relayStages?: StatsRelayStage[];
  activeRound?: MultiplayerRoundDraft;
  activeRelayStage?: MultiplayerRelayStageDraft;
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
  multiplayerMode: "all" | MultiplayerMode;
  difficulty?: "all" | StatsDifficulty;
}

export function workCode(mainlineIndex?: number, fallback = "TH--"): string {
  if (!Number.isFinite(mainlineIndex)) return fallback;
  return `TH${String(mainlineIndex).padStart(2, "0")}`;
}
