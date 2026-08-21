"use client";

// 整场结果弹窗（08 §10.3）：胜者/比分/原因 + 再来一局 + 返回大厅。
import { RotateCcw, Trophy } from "lucide-react";
import type { MatchEndedPayload } from "@touhouflandre/shared";
import { ROOM_FORMAT_SHORT } from "../../domain/multiRoom";
import {
  resultForMemberId,
  sortMembersBySeat,
} from "../../domain/memberCollections";
import type { components } from "../../generated/api";
import { useModalFocus } from "../../hooks/useModalFocus";
import { Paper, PaperButton } from "@/components/paper";

const REASON_LABEL: Record<string, string> = {
  normal: "正常完赛",
  forfeit: "有玩家弃赛",
  disconnect: "有玩家断线",
  server_restart: "服务重启",
  round_cap: "局数上限",
};

export function matchReasonLabel(reason: string) {
  return REASON_LABEL[reason] ?? reason;
}

export function MatchResultOverlay({
  result,
  memberId,
  members,
  format,
  rematchReady,
  onRematch,
  onLeave,
}: {
  result: MatchEndedPayload;
  memberId?: string | null;
  members?: components["schemas"]["MemberView"][];
  format: string;
  rematchReady: Array<{ memberId: string; seat: number; ready: boolean }>;
  onRematch: () => void;
  onLeave: () => void;
}) {
  const { dialogRef, onDialogKeyDown } = useModalFocus<HTMLDivElement>();
  const viewerResult =
    result.viewerResult ??
    resultForMemberId(result.results, memberId) ??
    "draw";
  const won = viewerResult === "win";
  const mine = Boolean(
    memberId &&
    rematchReady.find((entry) => entry.memberId === memberId)?.ready,
  );
  const readyCount = rematchReady.filter((entry) => entry.ready).length;
  const rosterSize = result.scores.length;
  const waitingMembers = sortMembersBySeat(result.results).filter(
    (entry) =>
      !rematchReady.find((ready) => ready.memberId === entry.memberId)?.ready,
  );
  const ranking = result.ranking ?? [];
  const sharedFirstCount = ranking.filter((entry) => entry.rank === 1).length;
  const viewerRanking = memberId
    ? ranking.find((entry) => entry.memberId === memberId)
    : undefined;
  const sharedFirst = sharedFirstCount > 1;
  const viewerSharedFirst = sharedFirst && viewerRanking?.rank === 1;
  const resultLabel = viewerSharedFirst
    ? "并列第一"
    : sharedFirst && Boolean(viewerRanking)
      ? "对局失利"
      : won
        ? "对局获胜"
        : viewerResult === "draw"
          ? "对局平局"
          : "对局失利";
  const highlighted = resultLabel === "并列第一" || resultLabel === "对局获胜";
  const formatLabel = result.ranking?.length
    ? "积分淘汰"
    : (ROOM_FORMAT_SHORT[format as keyof typeof ROOM_FORMAT_SHORT] ?? format);

  return (
    <div
      aria-labelledby="match-result-title"
      aria-modal="true"
      className="multiplayer-result-backdrop"
      onKeyDown={onDialogKeyDown}
      ref={dialogRef}
      role="dialog"
    >
      <Paper
        animateOnMount={false}
        as="div"
        elevation="lg"
        className="match-result-paper"
        folded
        sticker={false}
        unfoldOnHover={false}
      >
        <Trophy
          size={30}
          className={`match-result-trophy ${highlighted ? "match-result-trophy-highlighted" : ""}`}
          aria-hidden="true"
        />
        <MatchSettlementSummary
          eyebrow={`第 ${result.matchIndex + 1} 场 · ${formatLabel} · ${matchReasonLabel(result.reason)}`}
          highlighted={highlighted}
          members={members}
          result={result}
          title={resultLabel}
          titleId="match-result-title"
          viewerMemberId={memberId}
        />
        <div className="match-result-actions">
          <PaperButton
            className="match-result-action"
            disabled={mine}
            filled
            pattern={false}
            onClick={onRematch}
          >
            <RotateCcw size={16} aria-hidden="true" />
            {mine ? `已确认 ${readyCount}/${rosterSize}` : "确认再来一局"}
          </PaperButton>
          {readyCount > 0 && !mine && (
            <p className="match-result-ready-status" data-tone="success">
              已有 {readyCount}/{rosterSize} 人确认再来一局
            </p>
          )}
          {waitingMembers.length > 0 && (
            <p className="match-result-ready-status">
              待确认：
              {waitingMembers
                .map(
                  (entry) =>
                    members?.find(
                      (member) => member.memberId === entry.memberId,
                    )?.displayName ?? `玩家 ${entry.seat}`,
                )
                .join("、")}
            </p>
          )}
          <PaperButton
            className="match-result-action match-result-secondary-action"
            folded={false}
            onClick={onLeave}
          >
            返回大厅
          </PaperButton>
        </div>
      </Paper>
    </div>
  );
}

export function MatchSettlementSummary({
  eyebrow,
  highlighted = false,
  members,
  result,
  title,
  titleId,
  viewerMemberId,
}: {
  eyebrow: string;
  highlighted?: boolean;
  members?: components["schemas"]["MemberView"][];
  result: MatchEndedPayload;
  title: string;
  titleId: string;
  viewerMemberId?: string | null;
}) {
  const hasRanking = Boolean(result.ranking?.length);
  const scoresByMemberId = new Map(
    result.scores.map((entry) => [entry.memberId, entry]),
  );
  const rows = hasRanking
    ? [...(result.ranking ?? [])]
        .sort((left, right) => left.rank - right.rank || left.seat - right.seat)
        .map((entry) => ({
          eliminatedRound: entry.eliminatedRound,
          memberId: entry.memberId,
          rank: entry.rank,
          result: undefined,
          score: entry.score,
          seat: entry.seat,
          status: entry.status,
        }))
    : sortMembersBySeat(result.results).map((entry) => ({
        eliminatedRound: undefined,
        memberId: entry.memberId,
        rank: undefined,
        result: entry.result,
        score: scoresByMemberId.get(entry.memberId)?.score ?? 0,
        seat: entry.seat,
        status: undefined,
      }));

  return (
    <div
      className="match-settlement-summary"
      data-highlighted={highlighted ? "true" : "false"}
    >
      <p className="match-settlement-eyebrow">{eyebrow}</p>
      <h2 id={titleId}>{title}</h2>
      <section
        aria-labelledby={`${titleId}-standings`}
        className="match-settlement-standings"
      >
        <h3 id={`${titleId}-standings`}>
          {hasRanking ? "最终排名" : "最终比分"}
        </h3>
        <div aria-hidden="true" className="match-settlement-columns">
          <span>{hasRanking ? "名次" : "席位"}</span>
          <span>玩家</span>
          <span>状态</span>
          <span>得分</span>
        </div>
        <ol className="match-settlement-list">
          {rows.map((entry) => (
            <li
              className="match-settlement-row"
              data-rank={entry.rank}
              data-status={entry.status}
              data-viewer={entry.memberId === viewerMemberId ? "true" : "false"}
              key={entry.memberId}
            >
              <strong className="match-settlement-rank">
                {entry.rank ? `#${entry.rank}` : `P${entry.seat}`}
              </strong>
              <span className="match-settlement-identity">
                <strong>
                  {settlementMemberLabel(entry, members, viewerMemberId)}
                </strong>
              </span>
              <span className="match-settlement-status">
                {settlementStatusLabel(entry)}
              </span>
              <strong className="match-settlement-score">
                {entry.score} 分
              </strong>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function settlementStatusLabel(entry: {
  eliminatedRound?: number;
  result?: "win" | "draw" | "loss";
  status?: "active" | "eliminated" | "left";
}) {
  if (entry.eliminatedRound) return `第 ${entry.eliminatedRound} 局淘汰`;
  if (entry.status === "eliminated") return "已淘汰";
  if (entry.status === "left") return "已离场";
  if (entry.status === "active") return "完赛";
  if (entry.result === "win") return "胜";
  if (entry.result === "draw") return "平";
  return "负";
}

function settlementMemberLabel(
  entry: { memberId: string; seat: number },
  members: components["schemas"]["MemberView"][] | undefined,
  viewerMemberId: string | null | undefined,
): string {
  const name =
    members?.find((member) => member.memberId === entry.memberId)
      ?.displayName ?? `玩家 ${entry.seat}`;
  const suffix = entry.memberId === viewerMemberId ? "我" : `P${entry.seat}`;
  return `${name}(${suffix})`;
}
