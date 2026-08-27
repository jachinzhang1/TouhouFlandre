"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

export type MarqueeTitleProps = {
  children: string;
  behavior?: "always" | "hover";
  className?: string;
};

function readReducedMotionPreference(): boolean {
  return typeof window !== "undefined"
    ? (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false)
    : false;
}

export function MarqueeTitle({
  children,
  behavior = "always",
  className,
}: MarqueeTitleProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measurementRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    readReducedMotionPreference,
  );
  const [duration, setDuration] = useState(8);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return;
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    const measure = () => {
      const container = containerRef.current;
      const text = measurementRef.current;
      if (!container || !text || reducedMotion) {
        setIsOverflowing(false);
        return;
      }

      const overflow = text.scrollWidth > container.clientWidth + 1;
      setIsOverflowing(overflow);
      if (overflow) {
        const distance = Math.max(40, text.scrollWidth - container.clientWidth);
        setDuration(Math.max(8, Math.min(24, distance / 18)));
      }
    };

    measure();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : null;
    if (observer && containerRef.current)
      observer.observe(containerRef.current);
    return () => observer?.disconnect();
  }, [children, reducedMotion]);

  const shouldScroll = isOverflowing && !reducedMotion;

  return (
    <div
      ref={containerRef}
      className={
        className ? `music-player-marquee ${className}` : "music-player-marquee"
      }
      role="text"
      aria-label={children}
      title={children}
      tabIndex={0}
    >
      <span
        className={
          shouldScroll
            ? `music-player-marquee-track ${
                behavior === "hover" ? "is-hover-scrolling" : "is-scrolling"
              }`
            : "music-player-marquee-track"
        }
        style={
          shouldScroll
            ? ({
                "--music-player-marquee-duration": `${duration}s`,
              } as CSSProperties)
            : undefined
        }
      >
        <span
          ref={measurementRef}
          className="music-player-marquee-text"
          aria-hidden="true"
        >
          {children}
        </span>
        {shouldScroll ? (
          <span className="music-player-marquee-text" aria-hidden="true">
            {children}
          </span>
        ) : null}
      </span>
    </div>
  );
}
