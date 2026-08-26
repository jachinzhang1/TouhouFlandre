"use client";

import { useRoomClock } from "../../hooks/useRoomClock";

export function MatchCountdownBand({
  targetAt,
  label,
  kind = "intermission",
}: {
  targetAt: string;
  label: string;
  kind?: "initial" | "intermission";
}) {
  const remaining = useRoomClock(targetAt);
  return (
    <div
      className="match-countdown-band mb-3 flex min-h-14 items-center justify-center border-y border-amber bg-paper px-3 py-2.5 text-center"
      data-match-countdown
      data-countdown-kind={kind}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <p className="m-0 text-[0.9rem] font-black text-amber tabular-nums">
        {remaining > 0
          ? `${label}将于 ${Math.ceil(remaining / 1000)} 秒后开始…`
          : `${label}即将开始…`}
      </p>
    </div>
  );
}
