"use client";

import { RotateCcw } from "lucide-react";
import { Paper, PaperButton } from "@/components/paper";
import type { MatchRankingEntry } from "./types";
import { useModalFocus } from "../../hooks/useModalFocus";

export function MatchFinishedBand({
  title = "最终排名",
  subtitle,
  ranking,
  ready,
  readyLabel,
  onRematch,
  onLeave,
}: {
  title?: string;
  subtitle?: string;
  ranking: readonly MatchRankingEntry[];
  ready: boolean;
  readyLabel: string;
  onRematch: () => void;
  onLeave: () => void;
}) {
  const { dialogRef, onDialogKeyDown } = useModalFocus<HTMLDivElement>();
  const titleId = "multiplayer-final-ranking";
  return (
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      role="dialog"
      className="multiplayer-result-backdrop"
      ref={dialogRef}
      onKeyDown={onDialogKeyDown}
      data-match-finished
    >
      <Paper
        as="div"
        className="round-result-paper"
        animateOnMount={false}
        folded={false}
        pattern={false}
        sticker={false}
        unfoldOnHover={false}
      >
        <header className="round-result-lead">
          <h2 id={titleId}>{title}</h2>
          {subtitle ? (
            <p className="text-sm text-ink-soft">{subtitle}</p>
          ) : null}
        </header>
        <ol className="round-result-ledger m-0 grid list-none gap-3 p-0">
          {[...ranking]
            .sort(
              (left, right) =>
                (left.order ?? left.rank ?? 0) -
                (right.order ?? right.rank ?? 0),
            )
            .map((entry) => (
              <li
                key={entry.id}
                className={`flex min-w-0 items-center justify-between gap-4 border-b border-line pb-3 ${entry.isViewer ? "font-bold text-vermilion" : "text-ink"}`}
              >
                <span>
                  {entry.rankLabel ?? `第 ${entry.rank} 名`} · {entry.label}
                </span>
                <span className="shrink-0 tabular-nums">
                  {entry.scoreLabel}
                </span>
              </li>
            ))}
        </ol>
        <div className="round-result-actions flex flex-wrap justify-center gap-3">
          <PaperButton onClick={onRematch} disabled={ready} filled tone="theme">
            <RotateCcw size={18} aria-hidden="true" />
            <span>{readyLabel}</span>
          </PaperButton>
          <PaperButton onClick={onLeave}>退出房间</PaperButton>
        </div>
      </Paper>
    </div>
  );
}
