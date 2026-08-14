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
const multiplayerSchema = z.object({
  ...baseShape,
  kind: z.literal("multiplayer"),
  mode: z.literal("multiplayer"),
  format: z.enum(["bo1", "bo3", "bo5", "bo7"]),
  multiplayerMode: z.enum(["race", "relay"]).default("race"),
  matchIndex: z.number().int().nonnegative(),
  reason: z.enum([
    "normal",
    "forfeit",
    "disconnect",
    "server_restart",
    "round_cap",
    "incomplete",
  ]),
  scoreSelf: z.number().int().nonnegative(),
  scoreOpponent: z.number().int().nonnegative().optional(),
  opponentScores: z.array(z.number().int().nonnegative()).optional(),
  rosterSize: z.number().int().min(2).optional(),
  playerLimit: z.number().int().min(2).max(8).optional(),
  memberSlot: memberSlotSchema.optional(),
  rounds: z.array(roundSchema),
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

function normalizeStatsRecord(
  record: z.infer<typeof recordSchema>,
): StatsRecord {
  if (record.kind === "multiplayer") {
    const {
      memberSlot: legacySlot,
      scoreOpponent: legacyScore,
      ...safe
    } = record;
    const rounds = safe.rounds.map((round) => ({
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
    }));
    return {
      ...safe,
      schemaVersion: STATS_SCHEMA_VERSION,
      multiplayerMode: record.multiplayerMode ?? "race",
      opponentScores:
        record.opponentScores ??
        (record.scoreOpponent === undefined ? [] : [record.scoreOpponent]),
      rosterSize: record.rosterSize ?? 2,
      playerLimit: record.playerLimit ?? 2,
      difficulty: record.difficulty ?? "unknown",
      rounds,
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
  storedRecords.forEach(assertStatsPrivacy);
  const file = {
    schemaVersion: STATS_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    records: storedRecords.map((record) =>
      normalizeStatsRecord(record as z.infer<typeof recordSchema>),
    ),
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
