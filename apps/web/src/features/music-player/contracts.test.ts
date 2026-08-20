import { describe, expect, it } from "vitest";
import {
  clampMediaTime,
  clampVolume,
  getVolumeIconLevel,
  isUsableDuration,
  MUSIC_PLAYER_DEFAULT_VOLUME,
  MUSIC_PLAYER_STATUSES,
} from "./contracts";

describe("music player contract helpers", () => {
  it("keeps media values finite and within their documented ranges", () => {
    expect(clampVolume(Number.NaN)).toBe(MUSIC_PLAYER_DEFAULT_VOLUME);
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(2)).toBe(1);
    expect(clampMediaTime(-1, 10)).toBe(0);
    expect(clampMediaTime(12, 10)).toBe(10);
    expect(clampMediaTime(Number.POSITIVE_INFINITY, 10)).toBe(0);
    expect(isUsableDuration(10)).toBe(true);
    expect(isUsableDuration(0)).toBe(false);
    expect(isUsableDuration(Number.NaN)).toBe(false);
  });

  it("matches the four documented volume icon thresholds", () => {
    expect(getVolumeIconLevel(0, false)).toBe("muted");
    expect(getVolumeIconLevel(0.33, false)).toBe("low");
    expect(getVolumeIconLevel(0.34, false)).toBe("medium");
    expect(getVolumeIconLevel(0.66, false)).toBe("medium");
    expect(getVolumeIconLevel(0.67, false)).toBe("high");
    expect(getVolumeIconLevel(1, true)).toBe("muted");
  });

  it("keeps the public status enum explicit for downstream issues", () => {
    expect(MUSIC_PLAYER_STATUSES).toEqual([
      "idle",
      "loading",
      "playing",
      "paused",
      "error",
    ]);
  });
});
