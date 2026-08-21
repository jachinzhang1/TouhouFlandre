"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import {
  clampVolume,
  MUSIC_PLAYER_DEFAULT_VOLUME,
  type MusicPlayerCommands,
  type MusicPlayerContextValue,
  type MusicPlayerInitialPreferences,
  type MusicPlayerPreferenceSnapshot,
  type MusicPlayerSelectionMode,
  type MusicPlayerViewState,
} from "./contracts";
import { createHtmlAudioAdapter, type MusicAudioAdapter } from "./audioAdapter";
import {
  createInitialMusicPlayerState,
  musicPlayerReducer,
  type MusicPlayerAction,
  type MusicPlayerReducerState,
} from "./playerReducer";
import {
  getNextMusicTrack,
  MUSIC_CATALOG,
  normalizeMusicSelection,
} from "./catalog";

const MusicPlayerContext = createContext<MusicPlayerContextValue | null>(null);

export type MusicPlayerProviderProps = {
  children?: ReactNode;
  initialPreferences?: MusicPlayerInitialPreferences;
  onPreferencesChange?: (snapshot: MusicPlayerPreferenceSnapshot) => void;
};

function createProviderInitialState({
  initialPreferences,
}: {
  initialPreferences?: MusicPlayerInitialPreferences;
}): MusicPlayerReducerState {
  const selectedQueue = normalizeMusicSelection(
    initialPreferences?.selectedTrackIds,
  );
  const queue = selectedQueue.length > 0 ? selectedQueue : [...MUSIC_CATALOG];
  const state = createInitialMusicPlayerState(queue);
  const currentTrack =
    queue.find((track) => track.id === initialPreferences?.currentTrackId) ??
    queue[0] ??
    null;
  const volume = clampVolume(
    initialPreferences?.volume ?? MUSIC_PLAYER_DEFAULT_VOLUME,
  );
  const storedLastVolume = clampVolume(
    initialPreferences?.lastNonZeroVolume ?? volume,
  );
  const lastNonZeroVolume =
    storedLastVolume > 0
      ? storedLastVolume
      : volume > 0
        ? volume
        : MUSIC_PLAYER_DEFAULT_VOLUME;
  return {
    ...state,
    currentTrack,
    volume,
    muted: initialPreferences?.muted ?? false,
    lastNonZeroVolume,
  };
}

function errorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message;
  }
  return "播放请求被浏览器拒绝。";
}

export function MusicPlayerProvider({
  children,
  initialPreferences,
  onPreferencesChange,
}: MusicPlayerProviderProps) {
  const [runtimeState, dispatch] = useReducer(
    musicPlayerReducer,
    { initialPreferences },
    createProviderInitialState,
  );
  const stateRef = useRef<MusicPlayerReducerState>(runtimeState);
  stateRef.current = runtimeState;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const adapterRef = useRef<MusicAudioAdapter | null>(null);
  const selectionModeRef = useRef<MusicPlayerSelectionMode>(
    initialPreferences?.selectionMode ??
      (initialPreferences?.selectedTrackIds ? "custom" : "default"),
  );
  const sourceTokenRef = useRef(0);
  const playAttemptRef = useRef<{ id: number; sourceToken: number } | null>(
    null,
  );
  const playAttemptIdRef = useRef(0);
  const send = useCallback((action: MusicPlayerAction) => {
    stateRef.current = musicPlayerReducer(stateRef.current, action);
    dispatch(action);
  }, []);

  const notifyPreferences = useCallback(() => {
    if (!onPreferencesChange) return;
    const state = stateRef.current;
    onPreferencesChange({
      selectionMode: selectionModeRef.current,
      selectedTrackIds: state.queue.map((track) => track.id),
      currentTrackId: state.currentTrack?.id,
      volume: state.volume,
      muted: state.muted,
      lastNonZeroVolume: state.lastNonZeroVolume,
    });
  }, [onPreferencesChange]);

  const requestPlay = useCallback(async () => {
    const adapter = adapterRef.current;
    const sourceToken = sourceTokenRef.current;
    if (!adapter || !stateRef.current.currentTrack) return;
    if (playAttemptRef.current?.sourceToken === sourceToken) return;

    const attempt = { id: ++playAttemptIdRef.current, sourceToken };
    playAttemptRef.current = attempt;
    send({ type: "play-request" });
    try {
      await adapter.play();
      if (
        playAttemptRef.current?.id === attempt.id &&
        sourceTokenRef.current === sourceToken
      ) {
        send({ type: "play-resolved" });
      }
    } catch (error: unknown) {
      if (
        playAttemptRef.current?.id === attempt.id &&
        sourceTokenRef.current === sourceToken
      ) {
        playAttemptRef.current = null;
        send({ type: "play-rejected", error: errorMessage(error) });
      }
    }
  }, [send]);

  const changeTrack = useCallback(
    (
      track: MusicPlayerReducerState["currentTrack"],
      playbackIntent: "paused" | "playing",
    ) => {
      const adapter = adapterRef.current;
      if (!adapter) return;
      playAttemptRef.current = null;
      const sourceToken = adapter.setSource(track?.audioUrl ?? null);
      sourceTokenRef.current = sourceToken;
      send({
        type: "source-request",
        track,
        sourceToken,
        playbackIntent,
      });
    },
    [send],
  );

  const moveTrack = useCallback(
    (offset: 1 | -1, fromEnded = false) => {
      const state = stateRef.current;
      if (!state.currentTrack || state.queue.length === 0) return;
      const nextTrack = getNextMusicTrack(
        state.queue,
        state.currentTrack,
        offset,
      );
      const shouldPlay = fromEnded || state.playbackIntent === "playing";
      if (!nextTrack) return;
      if (nextTrack.id === state.currentTrack.id) {
        const adapter = adapterRef.current;
        if (!adapter) return;
        adapter.seek(0);
        playAttemptRef.current = null;
        send({
          type: "ended-restart",
          sourceToken: sourceTokenRef.current,
          playbackIntent: shouldPlay ? "playing" : "paused",
        });
        if (shouldPlay) void requestPlay();
        return;
      }
      changeTrack(nextTrack, shouldPlay ? "playing" : "paused");
      notifyPreferences();
    },
    [changeTrack, notifyPreferences, requestPlay, send],
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const adapter = createHtmlAudioAdapter(audio);
    adapterRef.current = adapter;

    const unsubscribe = adapter.subscribe((event) => {
      if (event.sourceToken !== sourceTokenRef.current) return;
      if (event.type === "ended") {
        moveTrack(1, true);
        return;
      }
      if (event.type === "error") {
        playAttemptRef.current = null;
        adapter.pause();
      }
      send({ type: "media-event", event });
      if (
        event.type === "canplay" &&
        stateRef.current.playbackIntent === "playing"
      ) {
        void requestPlay();
      }
    });

    adapter.setVolume(stateRef.current.volume);
    adapter.setMuted(stateRef.current.muted);
    const sourceToken = adapter.setSource(
      stateRef.current.currentTrack?.audioUrl ?? null,
    );
    sourceTokenRef.current = sourceToken;
    send({
      type: "source-request",
      track: stateRef.current.currentTrack,
      sourceToken,
      playbackIntent: "paused",
    });

    return () => {
      unsubscribe();
      adapterRef.current = null;
      playAttemptRef.current = null;
    };
  }, [moveTrack, requestPlay, send]);

  const commands = useMemo<MusicPlayerCommands>(
    () => ({
      play: async () => {
        await requestPlay();
      },
      pause: () => {
        playAttemptRef.current = null;
        adapterRef.current?.pause();
        send({ type: "pause-request" });
      },
      togglePlayback: async () => {
        if (stateRef.current.playbackIntent === "playing") {
          playAttemptRef.current = null;
          adapterRef.current?.pause();
          send({ type: "pause-request" });
        } else {
          await requestPlay();
        }
      },
      playTrack: (trackId) => {
        const state = stateRef.current;
        const targetTrack = state.queue.find((track) => track.id === trackId);
        if (!targetTrack) return;

        if (targetTrack.id === state.currentTrack?.id) {
          if (state.status !== "playing") void requestPlay();
          return;
        }

        changeTrack(targetTrack, "playing");
        notifyPreferences();
      },
      previous: () => moveTrack(-1),
      next: () => moveTrack(1),
      seek: (seconds) => {
        if (!stateRef.current.duration || !Number.isFinite(seconds)) return;
        adapterRef.current?.seek(seconds);
      },
      setVolume: (volume) => {
        const nextVolume = clampVolume(volume);
        adapterRef.current?.setVolume(nextVolume);
        send({
          type: "set-volume",
          volume: nextVolume,
          muted: nextVolume > 0 ? false : stateRef.current.muted,
        });
        notifyPreferences();
      },
      toggleMute: () => {
        const state = stateRef.current;
        if (state.muted || state.volume <= 0) {
          const volume =
            state.lastNonZeroVolume > 0 ? state.lastNonZeroVolume : 0.7;
          adapterRef.current?.setVolume(volume);
          adapterRef.current?.setMuted(false);
          send({ type: "set-muted", muted: false, volume });
        } else {
          adapterRef.current?.setMuted(true);
          send({ type: "set-muted", muted: true, volume: state.volume });
        }
        notifyPreferences();
      },
      applySelection: (trackIds) => {
        const queue = normalizeMusicSelection(trackIds);
        if (queue.length === 0) {
          send({ type: "command-error", error: "至少选择一首可播放曲目。" });
          return;
        }
        const state = stateRef.current;
        selectionModeRef.current = "custom";
        const retained = state.currentTrack
          ? (queue.find((track) => track.id === state.currentTrack?.id) ?? null)
          : null;
        if (retained) {
          send({
            type: "queue-applied",
            queue,
            currentTrack: retained,
            sourceToken: sourceTokenRef.current,
            playbackIntent: state.playbackIntent,
            preserveSource: true,
          });
          notifyPreferences();
          return;
        }
        changeTrack(queue[0] ?? null, state.playbackIntent);
        send({
          type: "queue-applied",
          queue,
          currentTrack: queue[0] ?? null,
          sourceToken: sourceTokenRef.current,
          playbackIntent: state.playbackIntent,
          preserveSource: false,
        });
        notifyPreferences();
      },
    }),
    [changeTrack, moveTrack, notifyPreferences, requestPlay, send],
  );

  const state: MusicPlayerViewState = useMemo(() => {
    const {
      playbackIntent: _intent,
      sourceToken: _token,
      lastNonZeroVolume: _last,
      ...viewState
    } = runtimeState;
    return viewState;
  }, [runtimeState]);

  const contextValue = useMemo(() => ({ state, commands }), [commands, state]);

  return (
    <MusicPlayerContext.Provider value={contextValue}>
      {children}
      <audio
        ref={audioRef}
        aria-hidden="true"
        data-music-player-audio="true"
        preload="metadata"
        suppressHydrationWarning
      />
    </MusicPlayerContext.Provider>
  );
}

export function useMusicPlayer(): MusicPlayerContextValue {
  const context = useContext(MusicPlayerContext);
  if (!context) {
    throw new Error("useMusicPlayer must be used inside MusicPlayerProvider.");
  }
  return context;
}
