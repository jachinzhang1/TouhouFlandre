import { MemberScoreStrip } from "../../components/MemberScoreStrip";
import type { MatchSummaryModel } from "./types";

export function MatchSummaryBar({ model }: { model: MatchSummaryModel }) {
  return (
    <header
      className="mb-3 flex flex-wrap items-center justify-between gap-3 border-y border-line bg-paper px-3 py-2.5"
      data-match-summary
    >
      <span className="rounded bg-vermilion-soft px-2 py-0.5 text-[0.72rem] font-black text-vermilion">
        {model.identityLabel}
      </span>
      {model.indicators}
      <MemberScoreStrip entries={model.scoreEntries} />
      <span className="text-[0.72rem] text-ink-soft tabular-nums">
        {model.progressLabel}
      </span>
    </header>
  );
}
