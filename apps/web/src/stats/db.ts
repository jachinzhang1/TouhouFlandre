import Dexie, { type EntityTable } from "dexie";
import { STATS_SCHEMA_VERSION, type StatsDraft, type StatsMetadata, type StatsRecord } from "./types";

const DB_NAME = "touhouflandre-stats";
const CHANNEL_NAME = "touhouflandre:stats";

class StatsDatabase extends Dexie {
  records!: EntityTable<StatsRecord, "id">;
  drafts!: EntityTable<StatsDraft, "id">;
  metadata!: EntityTable<StatsMetadata, "key">;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      records: "id,kind,mode,startedAt,endedAt,outcome,format",
      drafts: "id,kind,updatedAt",
      metadata: "key",
    });
  }
}

export const statsDb = new StatsDatabase();

type StatsBroadcast = { type: "changed" | "cleared" | "imported"; at: string };

function broadcast(type: StatsBroadcast["type"]): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage({ type, at: new Date().toISOString() } satisfies StatsBroadcast);
  channel.close();
}

export function subscribeStatsChanges(onChange: (event: StatsBroadcast) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<StatsBroadcast>) => onChange(event.data);
  return () => channel.close();
}

export async function stableRecordId(sourceKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(sourceKey);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  return `stats_${hash.slice(0, 32)}`;
}

export async function getClearedAt(): Promise<string | undefined> {
  const row = await statsDb.metadata.get("clearedAt");
  return typeof row?.value === "string" ? row.value : undefined;
}

export async function putStatsRecord(record: StatsRecord): Promise<boolean> {
  const clearedAt = await getClearedAt();
  if (clearedAt && Date.parse(record.endedAt) <= Date.parse(clearedAt)) return false;
  await statsDb.records.put(record);
  broadcast("changed");
  return true;
}

export async function putStatsDraft(draft: StatsDraft): Promise<boolean> {
  const clearedAt = await getClearedAt();
  if (clearedAt && Date.parse(draft.startedAt) <= Date.parse(clearedAt)) return false;
  await statsDb.drafts.put(draft);
  return true;
}

export async function clearStatistics(): Promise<void> {
  const clearedAt = new Date().toISOString();
  await statsDb.transaction("rw", statsDb.records, statsDb.drafts, statsDb.metadata, async () => {
    await statsDb.records.clear();
    await statsDb.drafts.clear();
    await statsDb.metadata.put({ key: "clearedAt", value: clearedAt });
    await statsDb.metadata.put({ key: "schemaVersion", value: STATS_SCHEMA_VERSION });
  });
  broadcast("cleared");
}

export async function replaceStatistics(records: StatsRecord[]): Promise<void> {
  const importedAt = new Date().toISOString();
  await statsDb.transaction("rw", statsDb.records, statsDb.drafts, statsDb.metadata, async () => {
    await statsDb.records.clear();
    await statsDb.drafts.clear();
    await statsDb.records.bulkPut(records);
    await statsDb.metadata.put({ key: "lastImportAt", value: importedAt });
    await statsDb.metadata.put({ key: "schemaVersion", value: STATS_SCHEMA_VERSION });
  });
  broadcast("imported");
}

export async function mergeStatistics(records: StatsRecord[]): Promise<void> {
  await statsDb.transaction("rw", statsDb.records, statsDb.metadata, async () => {
    await statsDb.records.bulkPut(records);
    await statsDb.metadata.put({ key: "lastImportAt", value: new Date().toISOString() });
    await statsDb.metadata.put({ key: "schemaVersion", value: STATS_SCHEMA_VERSION });
  });
  broadcast("imported");
}

