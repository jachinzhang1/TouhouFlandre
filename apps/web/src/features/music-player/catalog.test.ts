import { describe, expect, it } from "vitest";
import {
  findMusicTrack,
  getNextMusicTrack,
  MUSIC_CATALOG,
  normalizeMusicSelection,
} from "./catalog";

const expectedTrackIds = [
  "gensoukyoku-bassui-day-06",
  "gensoukyoku-bassui-day-12",
  "kakunetsuzoushin-hisoutensoku-track-03",
];

describe("music player catalog", () => {
  it("exposes the validated catalog in canonical playback order", () => {
    expect(MUSIC_CATALOG.map((track) => track.id)).toEqual(expectedTrackIds);
    expect(
      MUSIC_CATALOG.every((track) =>
        track.coverUrl?.startsWith("/music/covers/"),
      ),
    ).toBe(true);
  });

  it("normalizes selections without accepting caller order or unknown ids", () => {
    expect(
      normalizeMusicSelection([
        expectedTrackIds[2],
        "missing-track",
        expectedTrackIds[0],
        expectedTrackIds[2],
      ]).map((track) => track.id),
    ).toEqual([expectedTrackIds[0], expectedTrackIds[2]]);
    expect(normalizeMusicSelection(undefined).map((track) => track.id)).toEqual(
      expectedTrackIds,
    );
    expect(normalizeMusicSelection([])).toEqual([]);
  });

  it("wraps previous and next for multi-track and single-track queues", () => {
    expect(getNextMusicTrack(MUSIC_CATALOG, MUSIC_CATALOG[0], -1)?.id).toBe(
      expectedTrackIds[2],
    );
    expect(getNextMusicTrack(MUSIC_CATALOG, MUSIC_CATALOG[2], 1)?.id).toBe(
      expectedTrackIds[0],
    );
    expect(getNextMusicTrack([MUSIC_CATALOG[0]], MUSIC_CATALOG[0], 1)?.id).toBe(
      expectedTrackIds[0],
    );
    expect(getNextMusicTrack([], null, 1)).toBeNull();
    expect(findMusicTrack(expectedTrackIds[1])?.id).toBe(expectedTrackIds[1]);
    expect(findMusicTrack("missing-track")).toBeNull();
  });
});
