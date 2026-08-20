import {
  clampMediaTime,
  clampVolume,
  type MusicPlayerPlaybackIntent,
} from "./contracts";

export const MUSIC_AUDIO_EVENT_TYPES = [
  "loadstart",
  "loadedmetadata",
  "durationchange",
  "canplay",
  "play",
  "pause",
  "timeupdate",
  "seeking",
  "seeked",
  "ended",
  "volumechange",
  "error",
] as const;

export type MusicAudioEventType = (typeof MUSIC_AUDIO_EVENT_TYPES)[number];

export type MusicAudioEvent = {
  type: MusicAudioEventType;
  sourceToken: number;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  error: string | null;
};

export type MusicAudioEventListener = (event: MusicAudioEvent) => void;

export type MusicAudioAdapter = {
  setSource(source: string | null): number;
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  subscribe(listener: MusicAudioEventListener): () => void;
  getPlaybackIntent(): MusicPlayerPlaybackIntent;
};

type ListenerEntry = {
  listener: MusicAudioEventListener;
  removeSourceListeners: () => void;
};

function readError(audio: HTMLAudioElement): string | null {
  const mediaError = audio.error;
  if (!mediaError) return null;
  return mediaError.message || `Media error ${mediaError.code}.`;
}

function readFinite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * Adapts one HTMLAudioElement and tags every event with the source generation
 * that registered it. Rebinding listeners on source changes prevents queued
 * events from an old source from mutating the new track's state.
 */
export function createHtmlAudioAdapter(
  audio: HTMLAudioElement,
): MusicAudioAdapter {
  audio.preload = "metadata";

  let sourceToken = 0;
  let playbackIntent: MusicPlayerPlaybackIntent = "paused";
  const listeners = new Set<ListenerEntry>();

  const makeEvent = (
    type: MusicAudioEventType,
    token: number,
  ): MusicAudioEvent => ({
    type,
    sourceToken: token,
    currentTime: readFinite(audio.currentTime),
    duration: readFinite(audio.duration),
    volume: clampVolume(audio.volume),
    muted: audio.muted,
    error: type === "error" ? readError(audio) : null,
  });

  const bindEntry = (entry: ListenerEntry, token: number) => {
    const handlers = MUSIC_AUDIO_EVENT_TYPES.map((type) => {
      const handler = () => entry.listener(makeEvent(type, token));
      audio.addEventListener(type, handler);
      return [type, handler] as const;
    });

    entry.removeSourceListeners = () => {
      for (const [type, handler] of handlers) {
        audio.removeEventListener(type, handler);
      }
    };
  };

  const rebindListeners = () => {
    for (const entry of listeners) {
      entry.removeSourceListeners();
      bindEntry(entry, sourceToken);
    }
  };

  return {
    setSource(source) {
      sourceToken += 1;
      rebindListeners();
      if (source) {
        audio.src = source;
      } else {
        audio.removeAttribute("src");
      }
      audio.load();
      return sourceToken;
    },

    async play() {
      playbackIntent = "playing";
      try {
        await audio.play();
      } catch (error) {
        playbackIntent = "paused";
        throw error;
      }
    },

    pause() {
      playbackIntent = "paused";
      audio.pause();
    },

    seek(seconds) {
      audio.currentTime = clampMediaTime(seconds, readFinite(audio.duration));
    },

    setVolume(volume) {
      const nextVolume = clampVolume(volume);
      audio.volume = nextVolume;
      if (nextVolume > 0) audio.muted = false;
    },

    setMuted(muted) {
      audio.muted = muted;
    },

    subscribe(listener) {
      const entry: ListenerEntry = {
        listener,
        removeSourceListeners: () => undefined,
      };
      listeners.add(entry);
      bindEntry(entry, sourceToken);
      return () => {
        entry.removeSourceListeners();
        listeners.delete(entry);
      };
    },

    getPlaybackIntent() {
      return playbackIntent;
    },
  };
}
