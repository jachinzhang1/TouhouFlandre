"use client";

import { Music2 } from "lucide-react";
import { useEffect, useState } from "react";

const PLACEHOLDER_COVER = "/music/placeholder-cover.png";

export type TrackCoverProps = {
  src?: string;
  alt: string;
};

export function TrackCover({ src, alt }: TrackCoverProps) {
  const [usingFallback, setUsingFallback] = useState(!src);
  const [fallbackFailed, setFallbackFailed] = useState(false);

  useEffect(() => {
    setUsingFallback(!src);
    setFallbackFailed(false);
  }, [src]);

  if (fallbackFailed) {
    return (
      <span className="music-player-cover music-player-cover-fallback" role="img" aria-label={alt}>
        <Music2 size={30} strokeWidth={1.8} aria-hidden="true" />
      </span>
    );
  }

  const imageSrc = usingFallback ? PLACEHOLDER_COVER : src;

  return (
    <span className="music-player-cover">
      <img
        src={imageSrc}
        alt={alt}
        loading="eager"
        onError={() => {
          if (usingFallback) {
            setFallbackFailed(true);
          } else {
            setUsingFallback(true);
          }
        }}
      />
    </span>
  );
}
