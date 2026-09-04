import { MemberScoreStrip } from "../../components/multiplayer/MemberScoreStrip";
import type { MatchSummaryModel } from "./types";

export function MatchSummaryBar({ model }: { model: MatchSummaryModel }) {
  return (
    <header
      className="match-summary-bar flex flex-wrap items-center justify-between gap-3"
      data-match-summary
    >
      <span className="label m-0 text-[0.72rem] font-black">
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
