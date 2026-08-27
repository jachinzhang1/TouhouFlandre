"use client";

import type { ReactNode } from "react";
import { formatRemaining, useRoomClock } from "../../hooks/useRoomClock";
import type { MatchStatusModel, MatchStatusTimer } from "./types";

export function MatchStatusBand({
  model,
  actions,
}: {
  model: MatchStatusModel;
  actions?: ReactNode;
}) {
  const toneClass =
    model.tone === "warning"
      ? "border-amber bg-amber-soft"
      : model.tone === "success"
        ? "border-jade bg-jade-soft"
        : model.tone === "danger"
          ? "border-vermilion bg-vermilion-soft"
          : model.active || model.tone === "accent"
            ? "border-vermilion bg-paper relay-current-turn-active"
            : "border-line bg-paper";
  return (
    <div
      className={`mb-3 flex min-h-14 flex-wrap items-center justify-between gap-3 border-y px-3 py-2.5 ${toneClass}`}
      data-match-status
      role="status"
      aria-live="polite"
    >
      <div className="min-w-0">
        <p className="m-0 text-[0.82rem] font-bold text-ink">{model.message}</p>
        {model.timers?.length ? (
          <p className="mt-1 mb-0 text-[0.7rem] text-ink-soft tabular-nums">
            {model.timers.map((timer, index) => (
              <span key={`${timer.label}:${index}`}>
                {index > 0 ? " · " : null}
                <StatusTimer timer={timer} />
              </span>
            ))}
          </p>
        ) : null}
      </div>
      {actions}
    </div>
  );
}

function StatusTimer({ timer }: { timer: MatchStatusTimer }) {
  const remaining = useRoomClock(timer.deadline ?? null);
  return (
    <>
      {timer.label} {timer.value ?? formatRemaining(remaining)}
    </>
  );
}
