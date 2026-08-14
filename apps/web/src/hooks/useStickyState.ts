"use client";

import { useEffect, useState, type RefObject } from "react";

export function useStickyState(ref: RefObject<HTMLElement | null>) {
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let animationFrame = 0;

    const update = () => {
      animationFrame = 0;
      const stickyTop = Number.parseFloat(getComputedStyle(element).top);
      const next =
        Number.isFinite(stickyTop) &&
        window.scrollY > 0 &&
        element.getBoundingClientRect().top <= stickyTop + 0.5;
      setStuck((current) => (current === next ? current : next));
    };
    const scheduleUpdate = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(update);
    };
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleUpdate);
    resizeObserver?.observe(element);
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    update();

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, [ref]);

  return stuck;
}
