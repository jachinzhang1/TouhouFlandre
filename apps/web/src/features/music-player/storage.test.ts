import { describe, expect, it, vi } from "vitest";
import { MUSIC_CATALOG } from "./catalog";
import {
  loadMusicPlayerSettings,
  saveMusicPlayerSettings,
} from "./storage";

function createStorage(initial?: string): Storage {
  let value = initial ?? null;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => {
      value = next;
    }),
    removeItem: vi.fn(),
    clear: vi.fn(),
    key: vi.fn(() => null),
    get length() {
      return value === null ? 0 : 1;
    },
  } as unknown as Storage;
}

describe("music player storage", () => {
  it("uses the default full catalog without writing on first access", () => {
    const storage = createStorage();
    const result = loadMusicPlayerSettings(MUSIC_CATALOG, storage);

    expect(result.snapshot).toMatchObject({
      selectionMode: "default",
      selectedTrackIds: MUSIC_CATALOG.map((track) => track.id),
      currentTrackId: MUSIC_CATALOG[0].id,
      volume: 0.7,
      muted: false,
    });
    expect(result.shouldWriteCorrection).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("normalizes custom IDs, current track and volume in catalog order", () => {
    const storage = createStorage(
      JSON.stringify({
        schemaVersion: 1,
        selectionMode: "custom",
        selectedTrackIds: [
          MUSIC_CATALOG[2].id,
          "missing-track",
          MUSIC_CATALOG[2].id,
          MUSIC_CATALOG[0].id,
        ],
        currentTrackId: "missing-track",
        volume: 4,
        muted: true,
        lastNonZeroVolume: -1,
      }),
    );
    const result = loadMusicPlayerSettings(MUSIC_CATALOG, storage);

    expect(result.snapshot).toMatchObject({
      selectionMode: "custom",
      selectedTrackIds: [MUSIC_CATALOG[0].id, MUSIC_CATALOG[2].id],
      currentTrackId: MUSIC_CATALOG[0].id,
      volume: 1,
      muted: true,
      lastNonZeroVolume: 1,
    });
    expect(result.shouldWriteCorrection).toBe(true);
  });

  it("keeps default selections open to newly added catalog tracks", () => {
    const addedTrack = {
      ...MUSIC_CATALOG[0],
      id: "added-track",
      trackNumber: 99,
    };
    const catalog = [...MUSIC_CATALOG, addedTrack];
    const storage = createStorage(
      JSON.stringify({
        schemaVersion: 1,
        selectionMode: "default",
        selectedTrackIds: MUSIC_CATALOG.map((track) => track.id),
        currentTrackId: MUSIC_CATALOG[0].id,
        volume: 0.7,
        muted: false,
      }),
    );

    expect(loadMusicPlayerSettings(catalog, storage).snapshot.selectedTrackIds).toContain(
      "added-track",
    );
  });

  it("does not auto-add newly added tracks to custom selections", () => {
    const addedTrack = {
      ...MUSIC_CATALOG[0],
      id: "added-track",
      trackNumber: 99,
    };
    const catalog = [...MUSIC_CATALOG, addedTrack];
    const storage = createStorage(
      JSON.stringify({
        schemaVersion: 1,
        selectionMode: "custom",
        selectedTrackIds: [MUSIC_CATALOG[0].id],
        currentTrackId: MUSIC_CATALOG[0].id,
        volume: 0.7,
        muted: false,
      }),
    );

    expect(loadMusicPlayerSettings(catalog, storage).snapshot.selectedTrackIds).toEqual([
      MUSIC_CATALOG[0].id,
    ]);
  });

  it("falls back from damaged data and preserves future versions", () => {
    const damaged = createStorage("{not-json");
    expect(loadMusicPlayerSettings(MUSIC_CATALOG, damaged)).toMatchObject({
      shouldWriteCorrection: true,
      futureVersion: false,
    });

    const future = createStorage(
      JSON.stringify({ schemaVersion: 2, selectedTrackIds: [] }),
    );
    const loadedFuture = loadMusicPlayerSettings(MUSIC_CATALOG, future);
    expect(loadedFuture).toMatchObject({
      shouldWriteCorrection: false,
      canWrite: false,
      futureVersion: true,
    });
    expect(
      saveMusicPlayerSettings(loadedFuture.snapshot, future),
    ).toMatchObject({ ok: false });
    expect(future.setItem).not.toHaveBeenCalled();
  });

  it("converts storage exceptions into non-blocking results", () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("blocked");
      }),
      setItem: vi.fn(() => {
        throw new Error("blocked");
      }),
    } as unknown as Storage;

    expect(loadMusicPlayerSettings(MUSIC_CATALOG, storage).canWrite).toBe(false);
    expect(
      saveMusicPlayerSettings(
        loadMusicPlayerSettings(MUSIC_CATALOG).snapshot,
        storage,
      ),
    ).toMatchObject({ ok: false });
  });
});
