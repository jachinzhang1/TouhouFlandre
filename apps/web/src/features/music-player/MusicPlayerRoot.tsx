"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { MusicPlayerInitialPreferences } from "./contracts";
import { PlayerCard } from "./components/PlayerCard";
import {
  FloatingPlayerButton,
  type FloatingPlayerButtonProps,
} from "./FloatingPlayerButton";
import { MusicPlayerProvider } from "./MusicPlayerProvider";

export const MUSIC_PLAYER_CARD_ID = "music-player-card";

function MusicPlayerShell({ children }: { children?: ReactNode }) {
  const [isCardOpen, setIsCardOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const toggleCard = useCallback(() => {
    setIsCardOpen((open) => !open);
  }, []);
  const closeCard = useCallback(() => {
    setIsCardOpen(false);
    window.requestAnimationFrame(() => launcherRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!isCardOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
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
  }, [closeCard, isCardOpen]);

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
        onClose={closeCard}
        onOpenPlaylist={() => {
          // MUS-006 replaces this seam with the playlist dialog opener.
        }}
      />
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
