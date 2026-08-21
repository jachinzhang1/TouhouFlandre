"use client";

import { useCallback, useState, type ReactNode } from "react";
import type { MusicPlayerInitialPreferences } from "./contracts";
import {
  FloatingPlayerButton,
  type FloatingPlayerButtonProps,
} from "./FloatingPlayerButton";
import { MusicPlayerProvider } from "./MusicPlayerProvider";

export const MUSIC_PLAYER_CARD_ID = "music-player-card";

function MusicPlayerShell({ children }: { children?: ReactNode }) {
  const [isCardOpen, setIsCardOpen] = useState(false);
  const toggleCard = useCallback(() => {
    setIsCardOpen((open) => !open);
  }, []);

  const buttonProps: FloatingPlayerButtonProps = {
    isOpen: isCardOpen,
    onToggle: toggleCard,
    cardId: MUSIC_PLAYER_CARD_ID,
  };

  return (
    <div className="music-player-shell" data-music-player-shell="true">
      <FloatingPlayerButton {...buttonProps} />
      {children}
    </div>
  );
}

/** Stable root-layout host. It must not be keyed by a route or page state. */
export function MusicPlayerRoot({
  children,
  initialPreferences,
}: {
  children?: ReactNode;
  initialPreferences?: MusicPlayerInitialPreferences;
}) {
  return (
    <MusicPlayerProvider initialPreferences={initialPreferences}>
      <MusicPlayerShell>{children}</MusicPlayerShell>
    </MusicPlayerProvider>
  );
}
