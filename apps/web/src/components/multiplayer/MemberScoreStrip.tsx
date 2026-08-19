import type { components } from "../../generated/api";
import type { MemberScoreView } from "@touhouflandre/shared";
import {
  scoreForMemberId,
  sortMembersBySeat,
} from "../../domain/memberCollections";

type MemberView = components["schemas"]["MemberView"];

export function MemberScoreStrip({
  label = "当前比分",
  members,
  scores,
  viewerMemberId,
  winnerMemberId,
}: {
  label?: string;
  members: readonly MemberView[];
  scores: readonly MemberScoreView[];
  viewerMemberId?: string | null;
  winnerMemberId?: string | null;
}) {
  return (
    <ol
      aria-label={label}
      className="member-score-strip flex min-w-0 flex-1 flex-wrap items-center justify-center gap-1.5"
    >
      {sortMembersBySeat(members).map((member) => {
        const score = scores.find(
          (entry) => entry.memberId === member.memberId,
        );
        const eliminated = score?.status === "eliminated";
        return (
          <li
            key={member.memberId}
            className={`flex min-w-0 items-center gap-1.5 rounded border px-2 py-1 text-[0.72rem] ${eliminated ? "border-vermilion bg-vermilion text-white" : member.memberId === viewerMemberId ? "border-vermilion bg-vermilion-soft text-vermilion" : "border-line bg-paper-muted text-ink-soft"}`}
          >
            <span className="max-w-28 truncate font-bold">
              {member.displayName}
              {member.memberId === viewerMemberId ? "（我）" : ""}
            </span>
            <strong
              className={`tabular-nums ${eliminated ? "text-white" : "text-ink"}`}
            >
              {scoreForMemberId(scores, member.memberId)}
            </strong>
            {eliminated ? <span className="font-bold">已淘汰</span> : null}
            {winnerMemberId === member.memberId ? <span>胜</span> : null}
            {member.status === "disconnected" ? <span>离线</span> : null}
            {member.status === "left" ? <span>离开</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
