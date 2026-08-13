"use client";

// 倒计时/间歇遮罩（08 §4.3）：round 1 倒计时 + 局间间歇，由服务端 startsAt 驱动。
import { useEffect, useState } from "react";

export function CountdownOverlay({ startsAt }: { startsAt: string }) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const tick = () => {
      setRemaining(Math.max(0, new Date(startsAt).getTime() - Date.now()));
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [startsAt]);

  if (remaining <= 0) return null;
  const seconds = Math.ceil(remaining / 1000);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(18,26,23,0.55)] backdrop-blur-[2px]">
      <div className="rounded-[10px] border border-line bg-paper px-10 py-8 text-center shadow-lg">
        <p className="mt-0 mb-2 text-[0.72rem] font-black tracking-[0.14em] text-vermilion">
          {seconds > 3 ? "局间准备" : "即将开始"}
        </p>
        <p
          className="m-0 font-brand text-[3rem] leading-none tabular-nums"
          aria-live="polite"
        >
          {seconds}
        </p>
        <p className="mb-0 mt-3 text-[0.78rem] text-ink-soft">
          倒计时结束后本局开始
        </p>
      </div>
    </div>
  );
}
