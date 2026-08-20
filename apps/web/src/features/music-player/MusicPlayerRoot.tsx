"use client";

/**
 * MUS-001 host boundary. MUS-003 will add the provider and UI around this
 * element; the host must remain mounted for the lifetime of the root layout.
 */
export function MusicPlayerRoot() {
  return (
    <audio
      aria-hidden="true"
      data-music-player-audio="true"
      preload="metadata"
      suppressHydrationWarning
    />
  );
}
