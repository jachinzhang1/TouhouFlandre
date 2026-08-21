import {
  clampVolume,
  MUSIC_PLAYER_DEFAULT_VOLUME,
  MUSIC_PLAYER_STORAGE_KEY,
  type MusicPlayerInitialPreferences,
  type MusicPlayerPreferenceSnapshot,
  type MusicPlayerSelectionMode,
} from "./contracts";
import { MUSIC_CATALOG } from "./catalog";
import type { MusicTrack } from "./contracts";
import { z } from "zod";

export const MUSIC_PLAYER_STORAGE_SCHEMA_VERSION = 1 as const;

export type StoredMusicPlayerSettingsV1 = {
  schemaVersion: typeof MUSIC_PLAYER_STORAGE_SCHEMA_VERSION;
  selectionMode: MusicPlayerSelectionMode;
  selectedTrackIds: string[];
  currentTrackId?: string;
  volume: number;
  muted: boolean;
  lastNonZeroVolume?: number;
};

const storedSettingsV1Schema = z.object({
  schemaVersion: z.literal(MUSIC_PLAYER_STORAGE_SCHEMA_VERSION),
  // Optional for the first draft of v1. Missing values are treated as custom
  // so an existing explicit selection is never widened during migration.
  selectionMode: z.enum(["default", "custom"]).optional(),
  selectedTrackIds: z.array(z.string()),
  currentTrackId: z.string().optional(),
  volume: z.number().finite(),
  muted: z.boolean(),
  lastNonZeroVolume: z.number().finite().optional(),
});

export type MusicPlayerStorageResult =
  | { ok: true }
  | { ok: false; error: string };

export type MusicPlayerStorageLoadResult = {
  initialPreferences: MusicPlayerInitialPreferences;
  snapshot: MusicPlayerPreferenceSnapshot;
  shouldWriteCorrection: boolean;
  canWrite: boolean;
  futureVersion: boolean;
  notice?: string;
};

function defaultSnapshot(catalog: readonly MusicTrack[]): MusicPlayerPreferenceSnapshot {
  const firstTrack = catalog[0];
  return {
    selectionMode: "default",
    selectedTrackIds: catalog.map((track) => track.id),
    currentTrackId: firstTrack?.id,
    volume: MUSIC_PLAYER_DEFAULT_VOLUME,
    muted: false,
    lastNonZeroVolume: MUSIC_PLAYER_DEFAULT_VOLUME,
  };
}
function toInitialPreferences(
  snapshot: MusicPlayerPreferenceSnapshot,
): MusicPlayerInitialPreferences {
  return {
    selectionMode: snapshot.selectionMode,
    selectedTrackIds: snapshot.selectedTrackIds,
    currentTrackId: snapshot.currentTrackId,
    volume: snapshot.volume,
    muted: snapshot.muted,
    lastNonZeroVolume: snapshot.lastNonZeroVolume,
  };
}

function toStoredSettings(
  snapshot: MusicPlayerPreferenceSnapshot,
): StoredMusicPlayerSettingsV1 {
  return {
    schemaVersion: MUSIC_PLAYER_STORAGE_SCHEMA_VERSION,
    selectionMode: snapshot.selectionMode,
    selectedTrackIds: [...snapshot.selectedTrackIds],
    ...(snapshot.currentTrackId
      ? { currentTrackId: snapshot.currentTrackId }
      : {}),
    volume: clampVolume(snapshot.volume),
    muted: snapshot.muted,
    lastNonZeroVolume: clampVolume(snapshot.lastNonZeroVolume),
  };
}

function normalizeSnapshot(
  value: z.infer<typeof storedSettingsV1Schema>,
  catalog: readonly MusicTrack[],
): MusicPlayerPreferenceSnapshot {
  const selectionMode = value.selectionMode ?? "custom";
  const knownIds = new Set(catalog.map((track) => track.id));
  const selectedIds =
    selectionMode === "default"
      ? catalog.map((track) => track.id)
      : catalog
          .filter((track) => knownIds.has(track.id) && value.selectedTrackIds.includes(track.id))
          .map((track) => track.id);
  const selectedTrackIds =
    selectedIds.length > 0 ? selectedIds : catalog.map((track) => track.id);
  const currentTrackId =
    value.currentTrackId && selectedTrackIds.includes(value.currentTrackId)
      ? value.currentTrackId
      : selectedTrackIds[0];
  const volume = clampVolume(value.volume);
  const storedLastVolume = clampVolume(value.lastNonZeroVolume ?? volume);

  return {
    selectionMode,
    selectedTrackIds,
    currentTrackId,
    volume,
    muted: value.muted,
    lastNonZeroVolume:
      storedLastVolume > 0
        ? storedLastVolume
        : volume > 0
          ? volume
          : MUSIC_PLAYER_DEFAULT_VOLUME,
  };
}

function parseStoredValue(raw: string):
  | { kind: "future" }
  | { kind: "invalid" }
  | { kind: "valid"; value: z.infer<typeof storedSettingsV1Schema> } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { kind: "invalid" };
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    "schemaVersion" in parsed &&
    typeof parsed.schemaVersion === "number" &&
    parsed.schemaVersion > MUSIC_PLAYER_STORAGE_SCHEMA_VERSION
  ) {
    return { kind: "future" };
  }

  const result = storedSettingsV1Schema.safeParse(parsed);
  return result.success
    ? { kind: "valid", value: result.data }
    : { kind: "invalid" };
}

function getDefaultStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadMusicPlayerSettings(
  catalog: readonly MusicTrack[] = MUSIC_CATALOG,
  storage: Storage | null = getDefaultStorage(),
): MusicPlayerStorageLoadResult {
  const fallback = defaultSnapshot(catalog);
  if (!storage) {
    return {
      initialPreferences: toInitialPreferences(fallback),
      snapshot: fallback,
      shouldWriteCorrection: false,
      canWrite: false,
      futureVersion: false,
      notice: "本次无法读取本地播放器设置，将使用默认曲库。",
    };
  }

  let raw: string | null;
  try {
    raw = storage.getItem(MUSIC_PLAYER_STORAGE_KEY);
  } catch {
    return {
      initialPreferences: toInitialPreferences(fallback),
      snapshot: fallback,
      shouldWriteCorrection: false,
      canWrite: false,
      futureVersion: false,
      notice: "本次无法读取本地播放器设置，将使用默认曲库。",
    };
  }

  if (raw === null) {
    return {
      initialPreferences: toInitialPreferences(fallback),
      snapshot: fallback,
      shouldWriteCorrection: false,
      canWrite: true,
      futureVersion: false,
    };
  }

  const parsed = parseStoredValue(raw);
  if (parsed.kind === "future") {
    return {
      initialPreferences: toInitialPreferences(fallback),
      snapshot: fallback,
      shouldWriteCorrection: false,
      canWrite: false,
      futureVersion: true,
      notice: "检测到更新版本的播放器设置，本版本不会覆盖它。",
    };
  }
  if (parsed.kind === "invalid") {
    return {
      initialPreferences: toInitialPreferences(fallback),
      snapshot: fallback,
      shouldWriteCorrection: true,
      canWrite: true,
      futureVersion: false,
      notice: "播放器设置已损坏，已回退到默认曲库。",
    };
  }

  const snapshot = normalizeSnapshot(parsed.value, catalog);
  const canonical = JSON.stringify(toStoredSettings(snapshot));
  const parsedRecord = JSON.stringify({
    schemaVersion: MUSIC_PLAYER_STORAGE_SCHEMA_VERSION,
    selectionMode: parsed.value.selectionMode ?? "custom",
    selectedTrackIds: parsed.value.selectedTrackIds,
    ...(parsed.value.currentTrackId
      ? { currentTrackId: parsed.value.currentTrackId }
      : {}),
    volume: parsed.value.volume,
    muted: parsed.value.muted,
    ...(parsed.value.lastNonZeroVolume !== undefined
      ? { lastNonZeroVolume: parsed.value.lastNonZeroVolume }
      : {}),
  });
  return {
    initialPreferences: toInitialPreferences(snapshot),
    snapshot,
    shouldWriteCorrection: canonical !== parsedRecord,
    canWrite: true,
    futureVersion: false,
  };
}

export function saveMusicPlayerSettings(
  snapshot: MusicPlayerPreferenceSnapshot,
  storage: Storage | null = getDefaultStorage(),
): MusicPlayerStorageResult {
  if (!storage) {
    return { ok: false, error: "本次无法访问浏览器本地存储。" };
  }

  try {
    const existing = storage.getItem(MUSIC_PLAYER_STORAGE_KEY);
    if (existing !== null && parseStoredValue(existing).kind === "future") {
      return { ok: false, error: "检测到更新版本的播放器设置，未覆盖原数据。" };
    }
    storage.setItem(
      MUSIC_PLAYER_STORAGE_KEY,
      JSON.stringify(toStoredSettings(snapshot)),
    );
    return { ok: true };
  } catch {
    return { ok: false, error: "本次设置无法保存到浏览器本地存储。" };
  }
}
