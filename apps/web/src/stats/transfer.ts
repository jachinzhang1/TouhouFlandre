import { z } from "zod";
import { mergeStatistics, replaceStatistics, statsDb } from "./db";
import {
  STATS_SCHEMA_VERSION,
  type StatsExportFile,
  type StatsRecord,
} from "./types";
export { assertStatsPrivacy } from "./privacy";
import { assertStatsPrivacy } from "./privacy";

const workSchema = z.object({
  id: z.string(),
  title: z.string(),
  code: z.string(),
});
const characterSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatarUrl: z.string().optional(),
  work: workSchema.optional(),
});
const memberSlotSchema = z.union([z.literal(1), z.literal(2)]);
const actorSchema = z.enum(["self", "other"]);
const guessSchema = characterSchema.extend({
  durationMs: z.number().nonnegative().optional(),
  correct: z.boolean(),
  memberSlot: memberSlotSchema.optional(),
});
const relayTurnSchema = z.discriminatedUnion("kind", [
  z.object({
    index: z.number().int().positive(),
    actor: actorSchema.optional(),
    memberSlot: memberSlotSchema.optional(),
    kind: z.literal("timeout"),
  }),
  z.object({
    index: z.number().int().positive(),
    actor: actorSchema.optional(),
    memberSlot: memberSlotSchema.optional(),
    kind: z.literal("pass"),
  }),
  z.object({
    index: z.number().int().positive(),
    actor: actorSchema.optional(),
    memberSlot: memberSlotSchema.optional(),
    kind: z.literal("guess"),
    guess: guessSchema,
  }),
]);
const roundSchema = z.object({
  roundIndex: z.number().int().positive(),
  startedAt: z.string(),
  endedAt: z.string(),
  durationMs: z.number().nonnegative(),
  result: z.enum(["win", "loss", "draw"]),
  answer: characterSchema,
  guesses: z.array(guessSchema),
  turns: z.array(relayTurnSchema).optional(),
  pointsAwarded: z.number().int().nonnegative().optional(),
  participationStatus: z
    .enum(["correct", "forfeited", "exhausted", "timed_out"])
    .optional(),
});
const relayStageSchema = z.object({
  stageIndex: z.number().int().positive(),
  assignment: z.enum(["paired", "bye"]),
  outcome: z.enum(["win", "loss", "draw", "bye"]),
  encounterEndReason: z
    .enum(["win", "loss", "draw", "forfeit", "timeout"])
    .optional(),
  scoreBefore: z.number().int().optional(),
  scoreDelta: z.number().int().optional(),
  scoreAfter: z.number().int().optional(),
  lifeBefore: z.enum(["healthy", "near_death"]).optional(),
  lifeAfter: z.enum(["healthy", "near_death"]).optional(),
  lifeTransition: z
    .enum(["none", "entered_near_death", "eliminated"])
    .optional(),
  encounter: roundSchema.optional(),
});
const outcomeSchema = z.enum([
  "win",
  "loss",
  "draw",
  "forfeit",
  "abandoned",
  "disconnect",
  "incomplete",
]);
const difficultySchema = z
  .enum(["easy", "normal", "hard", "lunatic", "custom", "unknown"])
  .default("unknown");
const schemaVersion = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(STATS_SCHEMA_VERSION),
]);
const baseShape = {
  id: z.string(),
  schemaVersion,
  startedAt: z.string(),
  endedAt: z.string(),
  durationMs: z.number().nonnegative(),
  outcome: outcomeSchema,
  difficulty: difficultySchema,
};
const singleSchema = z.object({
  ...baseShape,
  kind: z.literal("single"),
  mode: z.enum(["daily", "random"]),
  puzzleKey: z.string().optional(),
  round: roundSchema,
});
const multiplayerSchema = z
  .object({
    ...baseShape,
    kind: z.literal("multiplayer"),
    mode: z.literal("multiplayer"),
    format: z.enum(["bo1", "bo3", "bo5", "bo7"]),
    multiplayerMode: z.enum(["race", "relay"]).default("race"),
    ruleSetKey: z.string().min(1).optional(),
    ruleSetVersion: z.number().int().positive().optional(),
    matchIndex: z.number().int().nonnegative(),
    reason: z.enum([
      "normal",
      "forfeit",
      "disconnect",
      "server_restart",
      "round_cap",
      "insufficient_active_players",
      "incomplete",
    ]),
    scoreSelf: z.number().int(),
    scoreOpponent: z.number().int().optional(),
    opponentScores: z.array(z.number().int()).optional(),
    rosterSize: z.number().int().min(2).optional(),
    playerLimit: z.number().int().min(2).max(8).optional(),
    scoringMode: z.enum(["wins", "points", "placement"]).optional(),
    finalRank: z.number().int().positive().optional(),
    tiedForFirst: z.boolean().optional(),
    eliminatedRound: z.number().int().positive().optional(),
    eliminatedStage: z.number().int().positive().optional(),
    survivedStages: z.number().int().nonnegative().optional(),
    memberSlot: memberSlotSchema.optional(),
    rounds: z.array(roundSchema),
    relayStages: z.array(relayStageSchema).optional(),
  })
  .superRefine((record, context) => {
    if (record.schemaVersion === STATS_SCHEMA_VERSION) {
      if (!record.ruleSetKey || !record.ruleSetVersion) {
        context.addIssue({
          code: "custom",
          message: "stats v6 多人记录缺少完整 rule-set discriminator",
        });
      }
      if (record.multiplayerMode === "relay" && !record.relayStages) {
        context.addIssue({
          code: "custom",
          message: "stats v6 relay 记录缺少 stage 明细",
        });
      }
    }
    if (
      record.multiplayerMode === "race" &&
      (record.scoreSelf < 0 ||
        record.opponentScores?.some((score) => score < 0))
    ) {
      context.addIssue({
        code: "custom",
        message: "race 比分不能为负数",
      });
    }
  });
const recordSchema = z.discriminatedUnion("kind", [
  singleSchema,
  multiplayerSchema,
]);
const exportSchema = z.object({
  schemaVersion,
  exportedAt: z.string(),
  records: z.array(recordSchema),
});

export function normalizeStatsRecord(
  record: z.infer<typeof recordSchema> | StatsRecord,
): StatsRecord {
  if (record.kind === "multiplayer") {
    const parsed = record as z.infer<typeof multiplayerSchema>;
    const {
      memberSlot: legacySlot,
      scoreOpponent: legacyScore,
      scoringMode: legacyScoringMode,
      ...safe
    } = parsed;
    const normalizeRound = (round: (typeof safe.rounds)[number]) => ({
      ...round,
      guesses: round.guesses.map(({ memberSlot: _slot, ...guess }) => guess),
      turns: round.turns?.map((turn) => {
        const actor =
          turn.actor ?? (turn.memberSlot === legacySlot ? "self" : "other");
        if (turn.kind !== "guess") {
          const { memberSlot: _slot, ...rest } = turn;
          return { ...rest, actor };
        }
        const { memberSlot: _slot, guess, ...rest } = turn;
        const { memberSlot: _guessSlot, ...safeGuess } = guess;
        return { ...rest, actor, guess: safeGuess };
      }),
    });
    const rounds = safe.rounds.map(normalizeRound);
    const multiplayerMode = parsed.multiplayerMode ?? "race";
    const scoringMode = legacyScoringMode ?? "wins";
    const ruleSetKey =
      parsed.ruleSetKey ??
      (multiplayerMode === "relay" ? "legacy_wins" : scoringMode);
    const relayStages =
      multiplayerMode === "relay"
        ? (parsed.relayStages?.map((stage) => ({
            ...stage,
            encounter: stage.encounter
              ? normalizeRound(stage.encounter)
              : undefined,
          })) ??
          rounds.map((round) => ({
            stageIndex: round.roundIndex,
            assignment: "paired" as const,
            outcome: round.result,
            encounter: round,
          })))
        : undefined;
    return {
      ...safe,
      schemaVersion: STATS_SCHEMA_VERSION,
      multiplayerMode,
      ruleSetKey,
      ruleSetVersion: parsed.ruleSetVersion ?? 1,
      opponentScores:
        parsed.opponentScores ??
        (legacyScore === undefined ? [] : [legacyScore]),
      rosterSize: parsed.rosterSize ?? 2,
      playerLimit: parsed.playerLimit ?? 2,
      ...(multiplayerMode === "race" ? { scoringMode } : {}),
      tiedForFirst: parsed.tiedForFirst ?? false,
      difficulty: parsed.difficulty ?? "unknown",
      rounds,
      relayStages,
    } as StatsRecord;
  }
  return {
    ...record,
    schemaVersion: STATS_SCHEMA_VERSION,
    difficulty: record.difficulty ?? "unknown",
  } as StatsRecord;
}

export async function createStatsExport(): Promise<StatsExportFile> {
  const storedRecords = await statsDb.records.toArray();
  const records = storedRecords.map(normalizeStatsRecord);
  records.forEach(assertStatsPrivacy);
  const file = {
    schemaVersion: STATS_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    records,
  };
  assertStatsPrivacy(file);
  return file;
}

export function downloadStatsExport(file: StatsExportFile): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `touhouflandre-stats-${file.exportedAt.slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function parseStatsImport(text: string): StatsExportFile {
  const parsed = exportSchema.parse(JSON.parse(text));
  const file = {
    schemaVersion: STATS_SCHEMA_VERSION,
    exportedAt: parsed.exportedAt,
    records: parsed.records.map(normalizeStatsRecord),
  };
  assertStatsPrivacy(file);
  return file;
}

export async function previewStatsImport(
  records: StatsRecord[],
): Promise<{ total: number; additions: number; replacements: number }> {
  const existing = new Set(
    (await statsDb.records.bulkGet(records.map((record) => record.id)))
      .filter(Boolean)
      .map((record) => record!.id),
  );
  return {
    total: records.length,
    additions: records.length - existing.size,
    replacements: existing.size,
  };
}

export async function applyStatsImport(
  records: StatsRecord[],
  mode: "merge" | "replace",
): Promise<void> {
  if (mode === "replace") await replaceStatistics(records);
  else await mergeStatistics(records);
}
