"use client";

import { message as globalMessage } from "antd";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { MusicPlayerInitialPreferences } from "./contracts";
import { MUSIC_CATALOG } from "./catalog";
import { PlayerCard } from "./components/PlayerCard";
import { PlaylistDialog } from "./components/PlaylistDialog";
import {
  FloatingPlayerButton,
  type FloatingPlayerButtonProps,
} from "./FloatingPlayerButton";
import { MusicPlayerProvider } from "./MusicPlayerProvider";
import {
  loadMusicPlayerSettings,
  saveMusicPlayerSettings,
  type MusicPlayerStorageLoadResult,
} from "./storage";

export const MUSIC_PLAYER_CARD_ID = "music-player-card";

function MusicPlayerShell({ children }: { children?: ReactNode }) {
  const [isCardOpen, setIsCardOpen] = useState(false);
  const [isPlaylistOpen, setIsPlaylistOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const playlistButtonRef = useRef<HTMLButtonElement>(null);
  const toggleCard = useCallback(() => {
    setIsCardOpen((open) => !open);
  }, []);
  const closeCard = useCallback(() => {
    if (isPlaylistOpen) return;
    setIsCardOpen(false);
    window.requestAnimationFrame(() => launcherRef.current?.focus());
  }, [isPlaylistOpen]);
  const openPlaylist = useCallback(() => {
    setIsPlaylistOpen(true);
  }, []);
  const closePlaylist = useCallback(() => {
    setIsPlaylistOpen(false);
    window.requestAnimationFrame(() => {
      if (isCardOpen) {
        playlistButtonRef.current?.focus();
      } else {
        launcherRef.current?.focus();
      }
    });
  }, [isCardOpen]);

  useEffect(() => {
    if (!isCardOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (isPlaylistOpen) return;
      const target = event.target;
      if (target instanceof Node && !shellRef.current?.contains(target)) {
        closeCard();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeCard();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeCard, isCardOpen, isPlaylistOpen]);

  const buttonProps: FloatingPlayerButtonProps = {
    isOpen: isCardOpen,
    onToggle: toggleCard,
    cardId: MUSIC_PLAYER_CARD_ID,
    buttonRef: launcherRef,
  };

  return (
    <div
      ref={shellRef}
      className="music-player-shell"
      data-music-player-shell="true"
    >
      <FloatingPlayerButton {...buttonProps} />
      <PlayerCard
        open={isCardOpen}
        cardId={MUSIC_PLAYER_CARD_ID}
        onOpenPlaylist={openPlaylist}
        playlistButtonRef={playlistButtonRef}
      />
      <PlaylistDialog open={isPlaylistOpen} onClose={closePlaylist} />
      {children}
    </div>
  );
}

function bootFromInitialPreferences(
  initialPreferences: MusicPlayerInitialPreferences,
): MusicPlayerStorageLoadResult {
  const selectedTrackIds = initialPreferences.selectedTrackIds
    ? [...initialPreferences.selectedTrackIds]
    : MUSIC_CATALOG.map((track) => track.id);
  const selectionMode =
    initialPreferences.selectionMode ??
    (initialPreferences.selectedTrackIds ? "custom" : "default");
  const currentTrackId =
    initialPreferences.currentTrackId &&
    selectedTrackIds.includes(initialPreferences.currentTrackId)
      ? initialPreferences.currentTrackId
      : selectedTrackIds[0];
  const volume = initialPreferences.volume ?? 0.7;
  const lastNonZeroVolume = initialPreferences.lastNonZeroVolume ?? volume;
  return {
    initialPreferences: {
      ...initialPreferences,
      selectionMode,
      selectedTrackIds,
      currentTrackId,
      volume,
      muted: initialPreferences.muted ?? false,
      lastNonZeroVolume,
    },
    snapshot: {
      selectionMode,
      selectedTrackIds,
      currentTrackId,
      volume,
      muted: initialPreferences.muted ?? false,
      lastNonZeroVolume,
    },
    shouldWriteCorrection: false,
    canWrite: false,
    futureVersion: false,
  };
}

/** Stable root-layout host. It must not be keyed by a route or page state. */
export function MusicPlayerRoot({
  children,
  initialPreferences,
}: {
  children?: ReactNode;
  initialPreferences?: MusicPlayerInitialPreferences;
}) {
  const [loadedBoot, setLoadedBoot] = useState<MusicPlayerStorageLoadResult | null>(
    null,
  );
  const persistenceErrorRef = useRef<string | null>(null);

  useEffect(() => {
    const result = initialPreferences
      ? bootFromInitialPreferences(initialPreferences)
      : loadMusicPlayerSettings();
    if (result.notice) globalMessage.warning(result.notice);
    if (result.shouldWriteCorrection && result.canWrite) {
      const saved = saveMusicPlayerSettings(result.snapshot);
      if (!saved.ok) globalMessage.warning(saved.error);
    }
    setLoadedBoot(result);
  }, [initialPreferences]);

  const handlePreferencesChange = useCallback(
    (snapshot: Parameters<NonNullable<React.ComponentProps<typeof MusicPlayerProvider>["onPreferencesChange"]>>[0]) => {
      const result = saveMusicPlayerSettings(snapshot);
      if (result.ok) {
        persistenceErrorRef.current = null;
        return;
      }
      if (persistenceErrorRef.current === result.error) return;
      persistenceErrorRef.current = result.error;
      globalMessage.warning(result.error);
    },
    [],
  );

  if (!loadedBoot) return null;

  return (
    <MusicPlayerProvider
      initialPreferences={loadedBoot.initialPreferences}
      onPreferencesChange={handlePreferencesChange}
    >
      <MusicPlayerShell>{children}</MusicPlayerShell>
    </MusicPlayerProvider>
  );
}
