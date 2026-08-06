"use client";

// 局结果弹窗（08 §4.4）：胜负 + 答案揭示 + 「查看对局」按钮；
// 点击仅本地关闭弹窗，不暂停下一局倒计时（到点 round.playing 强制开新局）。
import { Check, X } from "lucide-react";
import type { RoundEndedPayload } from "@touhouflandre/shared";
import { useEffect, useState } from "react";

export function RoundResultOverlay({
  result,
  mySlot,
  nextRoundStartsAt,
  onView,
}: {
  result: RoundEndedPayload;
  mySlot: 1 | 2;
  nextRoundStartsAt: string | null;
  onView: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const won = result.result === "win";

  // 下一局倒计时（服务端 startsAt 驱动；查看对局不暂停）
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!nextRoundStartsAt) return;
    const tick = () => {
      setRemaining(Math.max(0, new Date(nextRoundStartsAt).getTime() - Date.now()));
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [nextRoundStartsAt]);

  if (dismissed) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(18,26,23,0.55)] p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-[420px] rounded-[10px] border border-line bg-paper p-6 text-center shadow-lg">
        <p className={`mt-0 mb-1 text-[0.72rem] font-black tracking-[0.14em] ${won ? "text-jade" : "text-vermilion"}`}>
          ROUND {result.roundIndex} · {won ? "本局获胜" : result.result === "draw" ? "本局平局" : "本局失利"}
        </p>
        <div className="mb-4 flex items-center justify-center gap-2">
          {won ? <Check size={18} className="text-jade" /> : <X size={18} className="text-vermilion" />}
          <span className="font-brand text-[1.4rem]">{result.answer.name}</span>
        </div>
        <p className="mb-4 text-[0.8rem] text-ink-soft">
          答案是 {result.answer.name} · 当前比分 {result.scores.slot1} : {result.scores.slot2}
        </p>
        <button
          type="button"
          onClick={onView}
          className="w-full rounded-[6px] bg-vermilion px-4 py-2.5 font-bold text-white hover:bg-vermilion-dark"
        >
          查看对局
        </button>
        {nextRoundStartsAt && remaining > 0 && (
          <p className="mt-3 text-[0.75rem] text-ink-soft" aria-live="polite">
            下一局 {Math.ceil(remaining / 1000)} 秒后开始（查看对局不会暂停）
          </p>
        )}
      </div>
    </div>
  );
}
