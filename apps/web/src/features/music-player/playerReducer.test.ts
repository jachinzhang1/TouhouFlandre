import { describe, expect, it } from "vitest";
import type { MusicAudioEvent } from "./audioAdapter";
import { MUSIC_CATALOG } from "./catalog";
import {
  createInitialMusicPlayerState,
  musicPlayerReducer,
  type MusicPlayerReducerState,
} from "./playerReducer";

function mediaEvent(
  type: MusicAudioEvent["type"],
  overrides: Partial<MusicAudioEvent> = {},
): MusicAudioEvent {
  return {
    type,
    sourceToken: 1,
    currentTime: 0,
    duration: 120,
    volume: 0.7,
    muted: false,
    error: null,
    ...overrides,
  };
}

function loadedState(): MusicPlayerReducerState {
  const initial = createInitialMusicPlayerState(MUSIC_CATALOG);
  return musicPlayerReducer(initial, {
    type: "source-request",
    track: MUSIC_CATALOG[0],
    sourceToken: 1,
    playbackIntent: "paused",
  });
}

describe("musicPlayerReducer", () => {
  it("maps loading, metadata, playback, seek and pause events", () => {
    let state = loadedState();
    expect(state.status).toBe("loading");

    state = musicPlayerReducer(state, {
      type: "media-event",
      event: mediaEvent("loadedmetadata"),
    });
    state = musicPlayerReducer(state, {
      type: "media-event",
      event: mediaEvent("canplay"),
    });
    expect(state).toMatchObject({ duration: 120, status: "paused" });

    state = musicPlayerReducer(state, { type: "play-request" });
    state = musicPlayerReducer(state, { type: "play-resolved" });
    expect(state).toMatchObject({
      status: "playing",
      playbackIntent: "playing",
    });

    state = musicPlayerReducer(state, {
      type: "media-event",
      event: mediaEvent("seeking", { currentTime: 999 }),
    });
    state = musicPlayerReducer(state, {
      type: "media-event",
      event: mediaEvent("seeked", { currentTime: 999 }),
    });
    expect(state).toMatchObject({ isSeeking: false, currentTime: 120 });

    state = musicPlayerReducer(state, { type: "pause-request" });
    expect(state).toMatchObject({ status: "paused", playbackIntent: "paused" });
  });

  it("ignores stale generations and invalid media values", () => {
    const state = loadedState();
    const stale = musicPlayerReducer(state, {
      type: "media-event",
      event: mediaEvent("error", { sourceToken: 0, error: "old source" }),
    });
    expect(stale).toBe(state);

    const invalidDuration = musicPlayerReducer(state, {
      type: "media-event",
      event: mediaEvent("durationchange", {
        duration: Number.POSITIVE_INFINITY,
      }),
    });
    expect(invalidDuration.duration).toBe(0);

    const invalidTime = musicPlayerReducer(state, {
      type: "media-event",
      event: mediaEvent("timeupdate", { currentTime: Number.NaN }),
    });
    expect(invalidTime.currentTime).toBe(0);
  });

  it("preserves runtime state when a new queue retains the current track", () => {
    let state = loadedState();
    state = { ...state, status: "playing", currentTime: 42, duration: 120 };
    const queue = [MUSIC_CATALOG[0], MUSIC_CATALOG[2]];
    state = musicPlayerReducer(state, {
      type: "queue-applied",
      queue,
      currentTrack: MUSIC_CATALOG[0],
      sourceToken: 1,
      playbackIntent: "playing",
      preserveSource: true,
    });
    expect(state).toMatchObject({
      queue,
      currentTrack: MUSIC_CATALOG[0],
      status: "playing",
      currentTime: 42,
      duration: 120,
    });
  });

  it("resets transient media state when the current track changes", () => {
    let state = { ...loadedState(), currentTime: 42, duration: 120 };
    state = musicPlayerReducer(state, {
      type: "source-request",
      track: MUSIC_CATALOG[1],
      sourceToken: 2,
      playbackIntent: "playing",
    });
    expect(state).toMatchObject({
      currentTrack: MUSIC_CATALOG[1],
      status: "loading",
      currentTime: 0,
      duration: 0,
      sourceToken: 2,
      playbackIntent: "playing",
    });
  });

  it("keeps media errors recoverable and does not disturb playback for invalid selection", () => {
    let state = loadedState();
    state = musicPlayerReducer(state, {
      type: "media-event",
      event: mediaEvent("error", { error: "decode failed" }),
    });
    expect(state).toMatchObject({
      status: "error",
      playbackIntent: "paused",
      error: "decode failed",
    });

    state = { ...state, status: "playing" };
    state = musicPlayerReducer(state, {
      type: "command-error",
      error: "至少选择一首可播放曲目。",
    });
    expect(state.status).toBe("playing");
    expect(state.error).toMatch(/至少选择一首/u);
  });

  it("tracks mute and the most recent non-zero volume", () => {
    let state = loadedState();
    state = musicPlayerReducer(state, {
      type: "set-volume",
      volume: 0.4,
      muted: false,
    });
    state = musicPlayerReducer(state, {
      type: "set-volume",
      volume: 0,
      muted: false,
    });
    expect(state).toMatchObject({ volume: 0, lastNonZeroVolume: 0.4 });

    state = musicPlayerReducer(state, {
      type: "set-muted",
      muted: false,
      volume: state.lastNonZeroVolume,
    });
    expect(state).toMatchObject({ volume: 0.4, muted: false });
  });

  it("restarts a single-track queue without forcing paused playback to start", () => {
    const initial = createInitialMusicPlayerState([MUSIC_CATALOG[0]]);
    const state = musicPlayerReducer(
      {
        ...initial,
        sourceToken: 1,
        status: "paused",
        currentTime: 120,
        duration: 120,
      },
      {
        type: "ended-restart",
        sourceToken: 1,
        playbackIntent: "paused",
      },
    );
    expect(state).toMatchObject({
      status: "paused",
      playbackIntent: "paused",
      currentTime: 0,
    });
  });
});
