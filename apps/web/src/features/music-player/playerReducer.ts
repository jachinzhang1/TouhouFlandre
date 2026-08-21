import {
  clampMediaTime,
  clampVolume,
  isUsableDuration,
  MUSIC_PLAYER_DEFAULT_VOLUME,
  type MusicPlayerPlaybackIntent,
  type MusicPlayerRuntimeState,
  type MusicPlayerViewState,
} from "./contracts";
import type { MusicAudioEvent } from "./audioAdapter";
import type { MusicTrack } from "./contracts";

export type MusicPlayerReducerState = MusicPlayerRuntimeState & {
  sourceToken: number;
  lastNonZeroVolume: number;
};

export type MusicPlayerAction =
  | {
      type: "source-request";
      track: MusicTrack | null;
      sourceToken: number;
      playbackIntent: MusicPlayerPlaybackIntent;
    }
  | {
      type: "queue-applied";
      queue: readonly MusicTrack[];
      currentTrack: MusicTrack | null;
      sourceToken: number;
      playbackIntent: MusicPlayerPlaybackIntent;
      preserveSource: boolean;
    }
  | { type: "play-request" }
  | { type: "play-resolved" }
  | { type: "play-rejected"; error: string }
  | { type: "pause-request" }
  | { type: "media-event"; event: MusicAudioEvent }
  | {
      type: "ended-restart";
      sourceToken: number;
      playbackIntent: MusicPlayerPlaybackIntent;
    }
  | { type: "set-volume"; volume: number; muted: boolean }
  | { type: "set-muted"; muted: boolean; volume: number }
  | { type: "command-error"; error: string };

export function createInitialMusicPlayerState(
  queue: readonly MusicTrack[],
): MusicPlayerReducerState {
  return {
    queue,
    currentTrack: queue[0] ?? null,
    status: queue.length > 0 ? "idle" : "error",
    isSeeking: false,
    duration: 0,
    currentTime: 0,
    volume: MUSIC_PLAYER_DEFAULT_VOLUME,
    muted: false,
    error: queue.length > 0 ? null : "至少需要一首可播放曲目。",
    playbackIntent: "paused",
    sourceToken: 0,
    lastNonZeroVolume: MUSIC_PLAYER_DEFAULT_VOLUME,
  };
}

function withViewState(
  state: MusicPlayerReducerState,
  values: Partial<MusicPlayerViewState> &
    Partial<
      Pick<
        MusicPlayerReducerState,
        "playbackIntent" | "sourceToken" | "lastNonZeroVolume"
      >
    >,
): MusicPlayerReducerState {
  return { ...state, ...values };
}

function mediaErrorText(error: string | null): string {
  return error?.trim() || "当前曲目无法播放，请尝试其他曲目。";
}

function reduceMediaEvent(
  state: MusicPlayerReducerState,
  event: MusicAudioEvent,
): MusicPlayerReducerState {
  if (event.sourceToken !== state.sourceToken) return state;

  switch (event.type) {
    case "loadstart":
      return withViewState(state, {
        status: "loading",
        currentTime: 0,
        duration: 0,
        isSeeking: false,
        error: null,
      });
    case "loadedmetadata":
    case "durationchange":
      return isUsableDuration(event.duration)
        ? withViewState(state, { duration: event.duration })
        : state;
    case "canplay":
      return withViewState(state, {
        status:
          state.playbackIntent === "playing"
            ? state.status === "playing"
              ? "playing"
              : "loading"
            : "paused",
      });
    case "play":
      return withViewState(state, { status: "playing", error: null });
    case "pause":
      return state.status === "error"
        ? state
        : withViewState(state, { status: "paused" });
    case "timeupdate":
      return withViewState(state, {
        currentTime: clampMediaTime(event.currentTime, state.duration),
      });
    case "seeking":
      return withViewState(state, { isSeeking: true });
    case "seeked":
      return withViewState(state, {
        isSeeking: false,
        currentTime: clampMediaTime(event.currentTime, state.duration),
      });
    case "volumechange": {
      const volume = clampVolume(event.volume);
      return withViewState(state, {
        volume,
        muted: event.muted,
        lastNonZeroVolume: volume > 0 ? volume : state.lastNonZeroVolume,
      });
    }
    case "error":
      return withViewState(state, {
        status: "error",
        error: mediaErrorText(event.error),
        playbackIntent: "paused",
      });
  }

  return state;
}

export function musicPlayerReducer(
  state: MusicPlayerReducerState,
  action: MusicPlayerAction,
): MusicPlayerReducerState {
  switch (action.type) {
    case "source-request":
      return {
        ...state,
        currentTrack: action.track,
        status: action.track ? "loading" : "error",
        currentTime: 0,
        duration: 0,
        isSeeking: false,
        error: action.track ? null : "至少需要一首可播放曲目。",
        playbackIntent: action.playbackIntent,
        sourceToken: action.sourceToken,
      };
    case "queue-applied":
      return action.preserveSource
        ? {
            ...state,
            queue: action.queue,
            currentTrack: action.currentTrack,
            sourceToken: action.sourceToken,
            playbackIntent: action.playbackIntent,
            error: null,
          }
        : {
            ...state,
            queue: action.queue,
            currentTrack: action.currentTrack,
            sourceToken: action.sourceToken,
            playbackIntent: action.playbackIntent,
            status: action.currentTrack ? "loading" : "error",
            currentTime: 0,
            duration: 0,
            isSeeking: false,
            error: action.currentTrack ? null : "至少需要一首可播放曲目。",
          };
    case "play-request":
      return withViewState(state, {
        playbackIntent: "playing",
        error: null,
        status: state.currentTrack ? state.status : "error",
      });
    case "play-resolved":
      return withViewState(state, {
        status: "playing",
        error: null,
      });
    case "play-rejected":
      return withViewState(state, {
        status: "error",
        playbackIntent: "paused",
        error: mediaErrorText(action.error),
      });
    case "pause-request":
      return withViewState(state, {
        status: "paused",
        playbackIntent: "paused",
      });
    case "media-event":
      return reduceMediaEvent(state, action.event);
    case "ended-restart":
      return action.sourceToken !== state.sourceToken
        ? state
        : withViewState(state, {
            status: action.playbackIntent === "playing" ? "loading" : "paused",
            currentTime: 0,
            isSeeking: false,
            error: null,
            playbackIntent: action.playbackIntent,
          });
    case "set-volume": {
      const volume = clampVolume(action.volume);
      return withViewState(state, {
        volume,
        muted: action.muted,
        lastNonZeroVolume: volume > 0 ? volume : state.lastNonZeroVolume,
      });
    }
    case "set-muted":
      return withViewState(state, {
        muted: action.muted,
        volume: clampVolume(action.volume),
        lastNonZeroVolume:
          action.volume > 0
            ? clampVolume(action.volume)
            : state.lastNonZeroVolume,
      });
    case "command-error":
      return withViewState(state, { error: action.error });
  }
}
