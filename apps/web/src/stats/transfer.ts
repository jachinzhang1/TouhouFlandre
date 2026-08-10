import { z } from "zod";
import { mergeStatistics, replaceStatistics, statsDb } from "./db";
import { STATS_SCHEMA_VERSION, type StatsExportFile, type StatsRecord } from "./types";

const workSchema = z.object({ id: z.string(), title: z.string(), code: z.string() });
const characterSchema = z.object({ id: z.string(), name: z.string(), avatarUrl: z.string().optional(), work: workSchema.optional() });
const memberSlotSchema = z.union([z.literal(1), z.literal(2)]);
const guessSchema = characterSchema.extend({ durationMs: z.number().nonnegative().optional(), correct: z.boolean(), memberSlot: memberSlotSchema.optional() });
const relayTurnSchema = z.discriminatedUnion("kind", [
  z.object({ index: z.number().int().positive(), memberSlot: memberSlotSchema, kind: z.literal("timeout") }),
  z.object({ index: z.number().int().positive(), memberSlot: memberSlotSchema, kind: z.literal("pass") }),
  z.object({ index: z.number().int().positive(), memberSlot: memberSlotSchema, kind: z.literal("guess"), guess: guessSchema }),
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
const outcomeSchema = z.enum(["win", "loss", "draw", "forfeit", "abandoned", "disconnect", "incomplete"]);
const difficultySchema = z.enum(["easy", "normal", "hard", "lunatic", "custom", "unknown"]).default("unknown");
const schemaVersion = z.union([z.literal(1), z.literal(2), z.literal(STATS_SCHEMA_VERSION)]);
const baseShape = {
  id: z.string(),
  schemaVersion,
  startedAt: z.string(),
  endedAt: z.string(),
  durationMs: z.number().nonnegative(),
  outcome: outcomeSchema,
  difficulty: difficultySchema,
};
const singleSchema = z.object({ ...baseShape, kind: z.literal("single"), mode: z.enum(["daily", "random"]), puzzleKey: z.string().optional(), round: roundSchema });
const multiplayerSchema = z.object({
  ...baseShape,
  kind: z.literal("multiplayer"),
  mode: z.literal("multiplayer"),
  format: z.enum(["bo1", "bo3", "bo5", "bo7"]),
  multiplayerMode: z.enum(["race", "relay"]).default("race"),
  memberSlot: memberSlotSchema.optional(),
  matchIndex: z.number().int().nonnegative(),
  reason: z.enum(["normal", "forfeit", "disconnect", "server_restart", "round_cap", "incomplete"]),
  scoreSelf: z.number().int().nonnegative(),
  scoreOpponent: z.number().int().nonnegative(),
  rounds: z.array(roundSchema),
});
const recordSchema = z.discriminatedUnion("kind", [singleSchema, multiplayerSchema]);
const exportSchema = z.object({ schemaVersion, exportedAt: z.string(), records: z.array(recordSchema) });

function normalizeStatsRecord(record: z.infer<typeof recordSchema>): StatsRecord {
  if (record.kind === "multiplayer") {
    return {
      ...record,
      schemaVersion: STATS_SCHEMA_VERSION,
      multiplayerMode: record.multiplayerMode ?? "race",
      difficulty: record.difficulty ?? "unknown",
    } as StatsRecord;
  }
  return { ...record, schemaVersion: STATS_SCHEMA_VERSION, difficulty: record.difficulty ?? "unknown" } as StatsRecord;
}

export async function createStatsExport(): Promise<StatsExportFile> {
  return {
    schemaVersion: STATS_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    records: (await statsDb.records.toArray()).map((record) => normalizeStatsRecord(record as z.infer<typeof recordSchema>)),
  };
}

export function downloadStatsExport(file: StatsExportFile): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `touhouflandre-stats-${file.exportedAt.slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function parseStatsImport(text: string): StatsExportFile {
  const parsed = exportSchema.parse(JSON.parse(text));
  return {
    schemaVersion: STATS_SCHEMA_VERSION,
    exportedAt: parsed.exportedAt,
    records: parsed.records.map(normalizeStatsRecord),
  };
}

export async function previewStatsImport(records: StatsRecord[]): Promise<{ total: number; additions: number; replacements: number }> {
  const existing = new Set((await statsDb.records.bulkGet(records.map((record) => record.id))).filter(Boolean).map((record) => record!.id));
  return { total: records.length, additions: records.length - existing.size, replacements: existing.size };
}

export async function applyStatsImport(records: StatsRecord[], mode: "merge" | "replace"): Promise<void> {
  if (mode === "replace") await replaceStatistics(records);
  else await mergeStatistics(records);
}

