"use client";

// 局结果弹窗（08 §4.4/§局末交互）：胜负 + 答案揭示 + 「查看对局」按钮；
// 点击仅本地关闭弹窗（露出局末完整棋盘），不暂停下一局倒计时
// （nextRoundStartsAt 由 round.ended 载荷携带，服务端 startsAt 驱动）。
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
  const winnerEntry = result.winnerMemberId
    ? result.results.find((entry) => entry.memberId === result.winnerMemberId)
    : undefined;
  const winnerName = winnerEntry
    ? (members?.find((member) => member.memberId === winnerEntry.memberId)
        ?.displayName ?? `玩家 ${winnerEntry.seat}`)
    : null;
  const winnerTitle = result.winnerMemberId
    ? result.winnerMemberId === memberId
      ? "你赢得本局"
      : `${winnerName ?? "对手"} 赢得本局`
    : "本局平局";
  const outcomeLabel =
    viewerResult === "win" ? "胜" : viewerResult === "loss" ? "负" : "平";

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
      className="multiplayer-result-backdrop"
      onKeyDown={onDialogKeyDown}
      ref={dialogRef}
      role="dialog"
    >
      <Paper
        animateOnMount={false}
        as="div"
        className="round-result-paper"
        elevation="lg"
        folded
        sticker={false}
        unfoldOnHover={false}
      >
        <header className="round-result-lead">
          <p className="round-result-eyebrow">
            第 {result.matchIndex + 1} 场 · 第 {result.roundIndex} 局
          </p>
          <span
            aria-label={`你的本局结果：${outcomeLabel}`}
            className="round-result-seal"
            data-outcome={viewerResult}
          >
            {outcomeLabel}
          </span>
          <h2 id="round-result-title">{winnerTitle}</h2>
        </header>

        <section
          aria-labelledby="round-result-answer-title"
          className="round-result-answer"
        >
          <h3 id="round-result-answer-title">本局答案</h3>
          <strong>{result.answer.name}</strong>
          <span>{result.answer.workTitle}</span>
        </section>

        <ResultList
          members={members ?? []}
          scores={result.scores}
          results={result.results}
          viewerMemberId={memberId}
        />

        {nextRoundStartsAt && remaining > 0 ? (
          <div className="round-result-next-state">
            <span>下一局自动开始</span>
            <strong
              aria-label={`下一局 ${Math.ceil(remaining / 1000)} 秒后开始`}
              role="timer"
            >
              {formatRoundCountdown(remaining)}
            </strong>
          </div>
        ) : null}

        <div className="round-result-actions">
          <PaperButton
            className="round-result-review-action"
            filled={!nextRoundStartsAt}
            onClick={dismiss}
          >
            {nextRoundStartsAt ? "查看本局棋盘" : "查看整场结果"}
          </PaperButton>
          <p>
            {nextRoundStartsAt
              ? "查看棋盘不会暂停倒计时。"
              : "本场已结束，继续查看最终结算。"}
          </p>
        </div>
      </Paper>
    </div>
  );
}

function formatRoundCountdown(milliseconds: number) {
  const seconds = Math.ceil(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
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
  const scoresByMemberId = new Map(
    scores.map((entry) => [entry.memberId, entry.score]),
  );
  return (
    <section
      aria-labelledby="round-result-score-title"
      className="round-result-ledger"
    >
      <h3 id="round-result-score-title">本局结果与总分</h3>
      <div aria-hidden="true" className="round-result-ledger-columns">
        <span>玩家</span>
        <span>本局结果</span>
        <span>总分</span>
      </div>
      <ul>
        {sortMembersBySeat(results).map((entry) => (
          <li
            data-result={entry.result}
            data-viewer={entry.memberId === viewerMemberId ? "true" : "false"}
            key={entry.memberId}
          >
            <span className="round-result-player">
              <strong>
                {members.find((member) => member.memberId === entry.memberId)
                  ?.displayName ?? `玩家 ${entry.seat}`}
              </strong>
              <span>
                P{entry.seat}
                {entry.memberId === viewerMemberId ? " · 我" : ""}
              </span>
            </span>
            <strong className="round-result-outcome">
              {entry.result === "win"
                ? "胜"
                : entry.result === "loss"
                  ? "负"
                  : "平"}
            </strong>
            <strong className="round-result-score">
              {scoresByMemberId.get(entry.memberId) ?? 0} 分
            </strong>
          </li>
        ))}
      </ul>
    </section>
  );
}
