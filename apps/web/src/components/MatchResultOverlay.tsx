"use client";

// 整场结果弹窗（08 §10.3）：胜者/比分/原因 + 再来一局 + 返回大厅。
import { RotateCcw, Trophy } from "lucide-react";
import type { MatchEndedPayload } from "@touhouflandre/shared";
import { ROOM_FORMAT_SHORT } from "../domain/multiRoom";
import {
  resultForMemberId,
  sortMembersBySeat,
} from "../domain/memberCollections";
import type { components } from "../generated/api";

const REASON_LABEL: Record<string, string> = {
  normal: "正常完赛",
  forfeit: "有玩家弃赛",
  disconnect: "有玩家断线",
  server_restart: "服务重启",
  round_cap: "局数上限",
};

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
  const scoreLine = sortMembersBySeat(result.scores)
    .map((entry) => entry.score)
    .join(" : ");
  const waitingMembers = sortMembersBySeat(result.results).filter(
    (entry) =>
      !rematchReady.find((ready) => ready.memberId === entry.memberId)?.ready,
  );
  const ranking = result.ranking ?? [];
  const sharedFirst = ranking.filter((entry) => entry.rank === 1).length > 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(18,26,23,0.55)] p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-[420px] rounded-[10px] border border-line bg-paper p-6 text-center shadow-lg">
        <Trophy
          size={30}
          className={`mx-auto mb-2 ${won ? "text-vermilion" : "text-ink-soft"}`}
          aria-hidden="true"
        />
        <p
          className={`mt-0 mb-1 text-[0.72rem] font-black tracking-[0.14em] ${won ? "text-vermilion" : "text-ink-soft"}`}
        >
          MATCH {result.matchIndex} ·{" "}
          {sharedFirst
            ? "并列第一"
            : won
              ? "对局获胜"
              : viewerResult === "draw"
                ? "对局平局"
                : "对局失利"}
        </p>
        <p className="mb-2 font-brand text-[1.6rem]">{scoreLine}</p>
        <p className="mb-4 text-[0.8rem] text-ink-soft">
          {ROOM_FORMAT_SHORT[format as keyof typeof ROOM_FORMAT_SHORT] ??
            format}{" "}
          · {REASON_LABEL[result.reason] ?? result.reason}
        </p>
        <ul className="mb-4 grid gap-1 text-left">
          {(ranking.length > 0
            ? ranking
            : sortMembersBySeat(result.results)
          ).map((entry) => (
            <li
              key={entry.memberId}
              className={`flex items-center justify-between rounded border px-2 py-1 text-[0.75rem] ${entry.memberId === memberId ? "border-vermilion bg-vermilion-soft" : "border-line bg-paper-muted"}`}
            >
              <span className="truncate">
                {"rank" in entry ? `第 ${entry.rank} 名 · ` : ""}
                {members?.find((member) => member.memberId === entry.memberId)
                  ?.displayName ?? `玩家 ${entry.seat}`}
                {entry.memberId === memberId ? "（我）" : ""}
              </span>
              <span className="font-bold">
                {"rank" in entry
                  ? `${entry.score} 分${entry.eliminatedRound ? ` · 第 ${entry.eliminatedRound} 局淘汰` : entry.status === "left" ? " · 离场" : ""}`
                  : `${result.scores.find((score) => score.memberId === entry.memberId)?.score ?? 0} · ${entry.result === "win" ? "胜" : entry.result === "loss" ? "负" : "平"}`}
              </span>
            </li>
          ))}
        </ul>
        <div className="grid gap-2">
          <button
            type="button"
            onClick={onRematch}
            disabled={mine}
            className="flex w-full items-center justify-center gap-2 rounded-[6px] bg-vermilion px-4 py-2.5 font-bold text-white hover:bg-vermilion-dark"
          >
            <RotateCcw size={16} aria-hidden="true" />
            {mine ? `已确认 ${readyCount}/${rosterSize}` : "再来一局"}
          </button>
          {readyCount > 0 && !mine && (
            <p className="m-0 text-[0.75rem] text-jade">
              已有 {readyCount}/{rosterSize} 人确认再来一局
            </p>
          )}
          {waitingMembers.length > 0 && (
            <p className="m-0 text-[0.75rem] text-ink-soft">
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
          <button
            type="button"
            onClick={onLeave}
            className="w-full rounded-[6px] border border-line-strong bg-paper px-4 py-2 font-semibold text-ink-soft hover:bg-paper-muted"
          >
            返回大厅
          </button>
        </div>
      </div>
    </div>
  );
}
