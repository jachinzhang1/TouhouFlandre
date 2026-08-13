"use client";

// 整场结果弹窗（08 §10.3）：胜者/比分/原因 + 再来一局 + 返回大厅。
import { RotateCcw, Trophy } from "lucide-react";
import type { MatchEndedPayload } from "@touhouflandre/shared";
import { ROOM_FORMAT_SHORT } from "../domain/multiRoom";
import { resultAtSeat, scoreAtSeat } from "../domain/memberCollections";

const REASON_LABEL: Record<string, string> = {
  normal: "正常完赛",
  forfeit: "对方弃赛",
  disconnect: "对方断线",
  server_restart: "服务重启",
  round_cap: "局数上限",
};

export function MatchResultOverlay({
  result,
  mySlot,
  format,
  rematchReady,
  onRematch,
  onLeave,
}: {
  result: MatchEndedPayload;
  mySlot: 1 | 2;
  format: string;
  rematchReady: [boolean, boolean];
  onRematch: () => void;
  onLeave: () => void;
}) {
  const viewerResult =
    result.viewerResult ?? resultAtSeat(result.results, mySlot) ?? "draw";
  const won = viewerResult === "win";
  const mine = rematchReady[mySlot - 1];
  const theirs = rematchReady[mySlot === 1 ? 1 : 0];

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
          {won ? "对局获胜" : viewerResult === "draw" ? "对局平局" : "对局失利"}
        </p>
        <p className="mb-2 font-brand text-[1.6rem]">
          {scoreAtSeat(result.scores, 1)} : {scoreAtSeat(result.scores, 2)}
        </p>
        <p className="mb-4 text-[0.8rem] text-ink-soft">
          {ROOM_FORMAT_SHORT[format as keyof typeof ROOM_FORMAT_SHORT] ??
            format}{" "}
          · {REASON_LABEL[result.reason] ?? result.reason}
        </p>
        <div className="grid gap-2">
          <button
            type="button"
            onClick={onRematch}
            className="flex w-full items-center justify-center gap-2 rounded-[6px] bg-vermilion px-4 py-2.5 font-bold text-white hover:bg-vermilion-dark"
          >
            <RotateCcw size={16} aria-hidden="true" />
            {mine ? "等待对方确认……" : "再来一局"}
          </button>
          {theirs && !mine && (
            <p className="m-0 text-[0.75rem] text-jade">对方想要再来一局</p>
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
