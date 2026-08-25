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

export function MemberScoreStrip(props: MemberScoreStripProps) {
  const entries =
    "entries" in props
      ? [...props.entries].sort((left, right) => left.seat - right.seat)
      : sortMembersBySeat(props.members).map((member) => {
          const score = props.scores.find(
            (entry) => entry.memberId === member.memberId,
          );
          const eliminated = score?.status === "eliminated";
          return {
            memberId: member.memberId,
            seat: member.seat,
            displayName: member.displayName,
            score: scoreForMemberId(props.scores, member.memberId),
            isViewer: member.memberId === props.viewerMemberId,
            isWinner: member.memberId === props.winnerMemberId,
            showSeat: false,
            winnerBeforeStatuses: true,
            tone: eliminated
              ? ("danger" as const)
              : member.memberId === props.viewerMemberId
                ? ("accent" as const)
                : ("default" as const),
            statusLabels: [
              ...(eliminated ? ["已淘汰"] : []),
              ...(member.status === "disconnected" ? ["离线"] : []),
              ...(member.status === "left" ? ["离开"] : []),
            ],
          } satisfies MemberScoreStripEntry;
        });
  return (
    <ol
      className="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-1.5 max-[680px]:order-last max-[680px]:w-full max-[680px]:basis-full max-[680px]:justify-start"
      aria-label="玩家积分"
    >
      {entries.map((entry) => {
        const tone = entry.tone ?? "default";
        const toneClass =
          tone === "danger"
            ? "border-vermilion bg-vermilion text-white"
            : tone === "warning"
              ? "border-amber bg-amber-soft text-ink"
              : tone === "success"
                ? "border-jade bg-jade-soft text-jade"
                : tone === "accent"
                  ? "border-vermilion bg-vermilion-soft text-vermilion"
                  : "border-line bg-paper-muted text-ink-soft";
        return (
          <li
            key={entry.memberId}
            className={`flex min-w-0 items-center gap-1.5 rounded border px-2 py-1 text-[0.72rem] ${toneClass}`}
            title={`${entry.displayName}（${entry.seat}）`}
          >
            {entry.showSeat === false ? (
              <span className="max-w-28 truncate font-bold">
                {entry.displayName}
                {entry.isViewer ? "（我）" : ""}
              </span>
            ) : (
              <>
                <span className="max-w-28 truncate font-bold">
                  {entry.displayName}
                </span>
                <span className="shrink-0">
                  {entry.isViewer ? "（我）" : `（${entry.seat}）`}
                </span>
              </>
            )}
            <strong
              className={`tabular-nums ${tone === "danger" ? "text-white" : "text-ink"}`}
            >
              {entry.score}
            </strong>
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
