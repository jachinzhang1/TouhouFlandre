import type { components } from "../generated/api";
import type { MemberScoreView } from "@touhouflandre/shared";
import {
  scoreForMemberId,
  sortMembersBySeat,
} from "../domain/memberCollections";

type MemberView = components["schemas"]["MemberView"];

export interface MemberScoreStripEntry {
  memberId: string;
  seat: number;
  displayName: string;
  score: number;
  isViewer?: boolean;
  isWinner?: boolean;
  showSeat?: boolean;
  winnerBeforeStatuses?: boolean;
  tone?: "default" | "accent" | "warning" | "danger" | "success";
  statusLabels?: readonly string[];
}

type MemberScoreStripProps =
  | { entries: readonly MemberScoreStripEntry[] }
  | {
      members: readonly MemberView[];
      scores: readonly MemberScoreView[];
      viewerMemberId?: string | null;
      winnerMemberId?: string | null;
    };

export function memberScoreEntries({
  members,
  scores,
  viewerMemberId,
  winnerMemberId,
}: {
  members: readonly MemberView[];
  scores: readonly MemberScoreView[];
  viewerMemberId?: string | null;
  winnerMemberId?: string | null;
}): MemberScoreStripEntry[] {
  return sortMembersBySeat(members).map((member) => {
    const score = scores.find((entry) => entry.memberId === member.memberId);
    const eliminated = score?.status === "eliminated";
    return {
      memberId: member.memberId,
      seat: member.seat,
      displayName: member.displayName,
      score: scoreForMemberId(scores, member.memberId),
      isViewer: member.memberId === viewerMemberId,
      isWinner: member.memberId === winnerMemberId,
      showSeat: true,
      winnerBeforeStatuses: true,
      tone: eliminated
        ? "danger"
        : member.memberId === viewerMemberId
          ? "accent"
          : "default",
      statusLabels: [
        ...(eliminated ? ["已淘汰"] : []),
        ...(member.status === "disconnected" ? ["离线"] : []),
        ...(member.status === "left" ? ["离开"] : []),
      ],
    } satisfies MemberScoreStripEntry;
  });
}

export function MemberScoreStrip(props: MemberScoreStripProps) {
  const entries =
    "entries" in props
      ? [...props.entries].sort((left, right) => left.seat - right.seat)
      : memberScoreEntries(props);
  return (
    <ol
      className="member-score-strip flex min-w-0 flex-1 flex-wrap items-center justify-center gap-1.5 max-[680px]:order-last max-[680px]:w-full max-[680px]:basis-full max-[680px]:justify-start"
      aria-label="玩家积分"
    >
      {entries.map((entry) => {
        const tone = entry.tone ?? "default";
        return (
          <li
            className="member-score-item"
            data-tone={tone}
            data-viewer={entry.isViewer ? "true" : undefined}
            data-winner={entry.isWinner ? "true" : undefined}
            key={entry.memberId}
            title={`${entry.displayName}(${entry.isViewer ? "我" : `P${entry.seat}`})`}
          >
            {entry.showSeat === false ? (
              <span className="max-w-28 truncate font-bold">
                {entry.displayName}
                {entry.isViewer ? "(我)" : ""}
              </span>
            ) : (
              <>
                <span className="max-w-28 truncate font-bold">
                  {entry.displayName}
                </span>
                <span className="shrink-0">
                  {entry.isViewer ? "(我)" : `(P${entry.seat})`}
                </span>
              </>
            )}
            <strong className="tabular-nums">{entry.score}</strong>
            {entry.isWinner && entry.winnerBeforeStatuses ? (
              <span>胜</span>
            ) : null}
            {entry.statusLabels?.map((label) => (
              <span key={label} className="font-bold">
                {label}
              </span>
            ))}
            {entry.isWinner && !entry.winnerBeforeStatuses ? (
              <span>胜</span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
