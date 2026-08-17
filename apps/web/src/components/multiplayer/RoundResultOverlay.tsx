"use client";

// 局结果弹窗（08 §4.4/§局末交互）：胜负 + 答案揭示 + 「查看对局」按钮；
// 点击仅本地关闭弹窗（露出局末完整棋盘），不暂停下一局倒计时
// （nextRoundStartsAt 由 round.ended 载荷携带，服务端 startsAt 驱动）。
import { Check, X } from "lucide-react";
import type { RoundEndedPayload } from "@touhouflandre/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  resultForMemberId,
  sortMembersBySeat,
} from "../../domain/memberCollections";
import type { components } from "../../generated/api";
import { useModalFocus } from "../../hooks/useModalFocus";
import { Paper, PaperButton } from "@/components/paper";

export function RoundResultOverlay({
  result,
  memberId,
  members,
  nextRoundStartsAt,
  onDismiss,
  autoDismissAtCountdownEnd = false,
}: {
  result: RoundEndedPayload;
  memberId?: string | null;
  members?: components["schemas"]["MemberView"][];
  nextRoundStartsAt: string | null;
  onDismiss?: () => void;
  autoDismissAtCountdownEnd?: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);
  const dismissedRef = useRef(false);
  const onDismissRef = useRef(onDismiss);
  const viewerResult =
    result.viewerResult ??
    resultForMemberId(result.results, memberId) ??
    "draw";
  const won = viewerResult === "win";

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    dismissedRef.current = false;
    setDismissed(false);
  }, [result.matchIndex, result.roundIndex]);

  const dismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    setDismissed(true);
    onDismissRef.current?.();
  }, []);
  const { dialogRef, onDialogKeyDown } = useModalFocus<HTMLDivElement>(
    dismiss,
    !dismissed,
  );

  // 下一局倒计时（服务端 startsAt 驱动；查看对局不暂停）
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!nextRoundStartsAt) {
      setRemaining(0);
      return;
    }
    const tick = () => {
      const nextRemaining = Math.max(
        0,
        new Date(nextRoundStartsAt).getTime() - Date.now(),
      );
      setRemaining(nextRemaining);
      if (autoDismissAtCountdownEnd && nextRemaining === 0) dismiss();
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [autoDismissAtCountdownEnd, dismiss, nextRoundStartsAt]);

  if (dismissed) return null;

  return (
    <div
      aria-labelledby="round-result-title"
      aria-modal="true"
      className="fixed inset-0 z-[var(--layer-modal)] flex items-center justify-center bg-[rgba(18,26,23,0.55)] p-4 backdrop-blur-[2px]"
      onKeyDown={onDialogKeyDown}
      ref={dialogRef}
      role="dialog"
    >
      <Paper
        animateOnMount={false}
        as="div"
        elevation="lg"
        className="w-full max-w-[420px] p-6 text-center"
        folded={false}
        pattern={false}
        sticker={false}
        unfoldOnHover={false}
      >
        <p
          id="round-result-title"
          className={`mt-0 mb-1 text-[0.72rem] font-black tracking-[0.14em] ${won ? "text-jade" : "text-vermilion"}`}
        >
          ROUND {result.roundIndex} ·{" "}
          {won ? "本局获胜" : viewerResult === "draw" ? "本局平局" : "本局失利"}
        </p>
        <div className="mb-4 flex items-center justify-center gap-2">
          {won ? (
            <Check size={18} className="text-jade" />
          ) : (
            <X size={18} className="text-vermilion" />
          )}
          <span className="font-brand text-[1.4rem]">{result.answer.name}</span>
        </div>
        <p className="mb-4 text-[0.8rem] text-ink-soft">
          答案是 {result.answer.name} · 当前比分{" "}
          {sortMembersBySeat(result.scores)
            .map((entry) => entry.score)
            .join(" : ")}
        </p>
        <ResultList
          members={members ?? []}
          scores={result.scores}
          results={result.results}
          viewerMemberId={memberId}
        />
        <PaperButton className="w-full" filled folded={false} onClick={dismiss}>
          查看对局
        </PaperButton>
        {nextRoundStartsAt && remaining > 0 && (
          <p className="mt-3 text-[0.75rem] text-ink-soft" aria-live="polite">
            下一局 {Math.ceil(remaining / 1000)} 秒后开始（查看对局不会暂停）
          </p>
        )}
      </Paper>
    </div>
  );
}

function ResultList({
  members,
  scores,
  results,
  viewerMemberId,
}: {
  members: components["schemas"]["MemberView"][];
  scores: RoundEndedPayload["scores"];
  results: RoundEndedPayload["results"];
  viewerMemberId?: string | null;
}) {
  return (
    <ul className="mb-4 grid gap-1 text-left">
      {sortMembersBySeat(results).map((entry) => (
        <li
          key={entry.memberId}
          className={`flex items-center justify-between rounded border px-2 py-1 text-[0.75rem] ${entry.memberId === viewerMemberId ? "border-vermilion bg-vermilion-soft" : "border-line bg-paper-muted"}`}
        >
          <span className="truncate">
            {members.find((member) => member.memberId === entry.memberId)
              ?.displayName ?? `玩家 ${entry.seat}`}
            {entry.memberId === viewerMemberId ? "（我）" : ""}
          </span>
          <span className="font-bold">
            {scores.find((score) => score.memberId === entry.memberId)?.score ??
              0}{" "}
            ·{" "}
            {entry.result === "win"
              ? "胜"
              : entry.result === "loss"
                ? "负"
                : "平"}
          </span>
        </li>
      ))}
    </ul>
  );
}
