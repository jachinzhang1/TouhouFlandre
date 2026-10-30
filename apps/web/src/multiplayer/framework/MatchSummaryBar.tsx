import { MemberScoreStrip } from "../../components/multiplayer/MemberScoreStrip";
import type { MatchSummaryModel } from "./types";
import { Paper } from "../../components/paper";

export function MatchSummaryBar({ model }: { model: MatchSummaryModel }) {
  return (
    <header className="match-summary-bar min-w-0" data-match-summary>
      <Paper
        as="div"
        className="match-summary-paper flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2.5 px-4 py-3 max-[680px]:gap-x-2.5 max-[680px]:gap-y-1.5 max-[680px]:px-3 max-[680px]:py-2.5 max-[680px]:pr-16"
        animateOnMount={false}
        folded={false}
        sticker={false}
      >
        <span className="m-0 font-brand text-[0.85rem] font-black text-vermilion">
          {model.identityLabel}
        </span>
        {model.indicators}
        <MemberScoreStrip entries={model.scoreEntries} />
        <span className="text-[0.72rem] text-ink-soft tabular-nums">
          {model.progressLabel}
        </span>
      </Paper>
    </header>
  );
}
