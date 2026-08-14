import type { components } from "../generated/api";
import {
  scoreForMemberId,
  sortMembersBySeat,
} from "../domain/memberCollections";

type MemberView = components["schemas"]["MemberView"];
type MemberScoreView = components["schemas"]["MemberScoreView"];

export function MemberScoreStrip({
  members,
  scores,
  viewerMemberId,
  winnerMemberId,
}: {
  members: readonly MemberView[];
  scores: readonly MemberScoreView[];
  viewerMemberId?: string | null;
  winnerMemberId?: string | null;
}) {
  return (
    <ol className="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-1.5">
      {sortMembersBySeat(members).map((member) => (
        <li
          key={member.memberId}
          className={`flex min-w-0 items-center gap-1.5 rounded border px-2 py-1 text-[0.72rem] ${
            member.memberId === viewerMemberId
              ? "border-vermilion bg-vermilion-soft text-vermilion"
              : "border-line bg-paper-muted text-ink-soft"
          }`}
        >
          <span className="max-w-28 truncate font-bold">
            {member.displayName}
            {member.memberId === viewerMemberId ? "（我）" : ""}
          </span>
          <strong className="tabular-nums text-ink">
            {scoreForMemberId(scores, member.memberId)}
          </strong>
          {winnerMemberId === member.memberId ? <span>胜</span> : null}
          {member.status === "disconnected" ? <span>离线</span> : null}
          {member.status === "left" ? <span>离开</span> : null}
        </li>
      ))}
    </ol>
  );
}
