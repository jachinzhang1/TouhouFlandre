"use client";

import { RotateCcw } from "lucide-react";
import type { MatchRankingEntry } from "./types";

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
  const titleId = "multiplayer-final-ranking";
  return (
    <section
      className="mb-3 border-y border-jade bg-jade-soft px-3 py-3"
      aria-labelledby={titleId}
      data-match-finished
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id={titleId} className="m-0 text-[0.9rem] font-black text-jade">
            {title}
          </h2>
          {subtitle ? (
            <span className="text-[0.7rem] text-ink-soft">{subtitle}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRematch}
            disabled={ready}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-[5px] bg-vermilion px-3 text-[0.72rem] font-bold text-white disabled:opacity-50"
          >
            <RotateCcw size={14} aria-hidden="true" />
            {readyLabel}
          </button>
          <button
            type="button"
            onClick={onLeave}
            className="min-h-8 rounded-[5px] border border-line-strong bg-paper px-3 text-[0.72rem] font-bold"
          >
            退出房间
          </button>
        </div>
      </div>
      <ol className="mt-3 grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
        {[...ranking]
          .sort(
            (left, right) =>
              (left.order ?? left.rank ?? 0) - (right.order ?? right.rank ?? 0),
          )
          .map((entry) => (
            <li
              key={entry.id}
              className={`flex min-w-0 items-center justify-between gap-2 rounded border px-2 py-1 text-[0.72rem] ${entry.isViewer ? "border-vermilion bg-paper" : "border-line bg-paper-muted"}`}
            >
              <span className="min-w-0 truncate font-bold">
                {entry.rankLabel ?? `第 ${entry.rank} 名`} · {entry.label}
              </span>
              <span className="shrink-0 tabular-nums">{entry.scoreLabel}</span>
            </li>
          ))}
      </ol>
    </section>
  );
}
