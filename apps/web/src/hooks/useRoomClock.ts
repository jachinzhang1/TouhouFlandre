"use client";

// 剩余时间渲染（08 §4.3：倒计时/间歇由服务端 startsAt 驱动，本地只渲染）。
import { useEffect, useState } from "react";

export function useRoomClock(target: string | null | undefined, intervalMs = 250): number {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!target) {
      setRemaining(0);
      return;
    }
    const tick = () => {
      setRemaining(Math.max(0, new Date(target).getTime() - Date.now()));
    };
    tick();
    const id = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(id);
  }, [target, intervalMs]);

  return remaining;
}

/** 毫秒 → mm:ss（倒计时展示）。 */
export function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
