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
      ? "text-amber"
      : model.tone === "success"
        ? "text-jade"
        : model.tone === "danger"
          ? "text-vermilion"
          : model.active || model.tone === "accent"
            ? "text-vermilion"
            : "text-ink";
  return (
    <div
      className={`match-status-band flex min-h-12 flex-wrap items-center justify-between gap-3 ${toneClass}`}
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
