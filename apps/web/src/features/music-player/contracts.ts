/**
 * Stable contract shared by the provider and the player UI.
 * The catalog package can provide richer records as long as they satisfy this
 * structural shape; the feature never needs to know how the catalog is loaded.
 */
export type MusicAlbum = {
  id: string;
  title: string;
  titleJa?: string;
  artist?: string;
  releaseYear?: number;
  order: number;
  coverUrl: `/music/covers/${string}`;
  sourceRefs: readonly string[];
};

export type MusicTrack = {
  id: string;
  albumId: string;
  trackNumber: number;
  title: string;
  titleJa?: string;
  artists: readonly string[];
  composer?: string;
  arranger?: string;
  audioUrl: `/music/tracks/${string}.mp3`;
  coverUrl?: `/music/covers/${string}`;
  sourceRefs: readonly string[];
};

export type MusicPlayerStatus =
  "idle" | "loading" | "playing" | "paused" | "error";

/** The desired state after a source change has settled. */
export type MusicPlayerPlaybackIntent = "paused" | "playing";

export type MusicPlayerViewState = {
  queue: readonly MusicTrack[];
  currentTrack: MusicTrack | null;
  status: MusicPlayerStatus;
  isSeeking: boolean;
  duration: number;
  currentTime: number;
  volume: number;
  muted: boolean;
  error: string | null;
};

/** Reducer-only state. Playback intent is deliberately not exposed to UI. */
export type MusicPlayerRuntimeState = MusicPlayerViewState & {
  playbackIntent: MusicPlayerPlaybackIntent;
};

export type MusicPlayerCommands = {
  play(): Promise<void>;
  pause(): void;
  togglePlayback(): Promise<void>;
  previous(): void;
  next(): void;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  toggleMute(): void;
  applySelection(trackIds: readonly string[]): void;
};

export type MusicPlayerContextValue = {
  state: MusicPlayerViewState;
  commands: MusicPlayerCommands;
};

/** Validated startup values. MUS-006 will populate these from localStorage. */
export type MusicPlayerInitialPreferences = {
  selectedTrackIds?: readonly string[];
  currentTrackId?: string;
  volume?: number;
  muted?: boolean;
  lastNonZeroVolume?: number;
};

export const MUSIC_PLAYER_STORAGE_KEY = "touhoufriberg:music-player";
export const MUSIC_PLAYER_DEFAULT_VOLUME = 0.7;

export const MUSIC_PLAYER_STATUSES: readonly MusicPlayerStatus[] = [
  "idle",
  "loading",
  "playing",
  "paused",
  "error",
];

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return MUSIC_PLAYER_DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, value));
}

export function clampMediaTime(seconds: number, duration: number): number {
  if (
    !Number.isFinite(seconds) ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    return 0;
  }
  return Math.min(duration, Math.max(0, seconds));
}

export function isUsableDuration(duration: number): boolean {
  return Number.isFinite(duration) && duration > 0;
}

export function getVolumeIconLevel(
  volume: number,
  muted: boolean,
): "muted" | "low" | "medium" | "high" {
  if (muted || volume <= 0) return "muted";
  if (volume < 0.34) return "low";
  if (volume < 0.67) return "medium";
  return "high";
}
