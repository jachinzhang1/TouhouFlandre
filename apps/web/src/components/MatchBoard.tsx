"use client";

// 对局视图（08 §10.2 布局调整）：比分条 + 双棋盘左右排布（左自己、右对手；
// 窄屏 max-[680px] 堆叠为上下）。搜索输入在底部固定条（GuessInputBar）。
import type { ReactNode } from "react";
import type { components } from "../generated/api";
import type { GuessField, RoundEndedPayload } from "@touhouflandre/shared";
import { useRoomClock, formatRemaining } from "../hooks/useRoomClock";
import { ROOM_FORMAT_SHORT } from "../domain/multiRoom";
import { boardAtSeat, scoreAtSeat } from "../domain/memberCollections";
import { OpponentBoard } from "./OpponentBoard";
import { SelfBoard } from "./SelfBoard";
import { GuessTable, type GuessRow } from "./GuessTable";

type MatchView = components["schemas"]["MatchView"];
type RoundView = components["schemas"]["RoundView"];

export function MatchBoard({
  format,
  match,
  round,
  mySlot,
  roundResult,
  catalogVersion,
  onGuess,
  disabled,
  roundActions,
  fields,
}: {
  format: string;
  match: MatchView;
  round: RoundView | null;
  mySlot: 1 | 2;
  roundResult: RoundEndedPayload | null;
  catalogVersion?: string;
  onGuess: (guessId: string) => void;
  disabled?: boolean;
  roundActions?: ReactNode;
  fields?: readonly GuessField[];
}) {
  const remaining = useRoomClock(round?.deadline ?? null);

  // 局末（roundResult 存在且未进入下一局）展示双方完整棋盘
  const ended = Boolean(roundResult);

  return (
    <section className="px-[18px] pt-5 pb-28">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-line bg-paper px-4 py-2.5 shadow-sm">
        <span className="rounded bg-vermilion-soft px-2 py-0.5 text-[0.72rem] font-black text-vermilion">
          {ROOM_FORMAT_SHORT[format as keyof typeof ROOM_FORMAT_SHORT] ??
            format}
        </span>
        <span className="text-[0.95rem] font-black tabular-nums">
          {scoreAtSeat(match.scores, 1)} : {scoreAtSeat(match.scores, 2)}
        </span>
        <span className="text-[0.75rem] text-ink-soft">
          第 {match.roundIndex} 局
          {match.targetWins > 1 ? ` · 先胜 ${match.targetWins} 局` : ""}
        </span>
        {round && !ended && (
          <span className="text-[0.72rem] text-ink-soft tabular-nums">
            剩余 {formatRemaining(remaining)}
          </span>
        )}
        {roundActions}
      </div>

      <div
        className={`grid items-start gap-3 max-[900px]:grid-cols-1 ${
          ended ? "grid-cols-2" : "grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"
        }`}
      >
        {ended && roundResult ? (
          <EndedBoards
            roundResult={roundResult}
            mySlot={mySlot}
            fields={fields}
          />
        ) : (
          <>
            <SelfBoard
              guesses={round?.self.guesses ?? []}
              playing={round?.status === "playing"}
              maxGuesses={round?.maxGuesses}
              fields={fields}
            />
            <OpponentBoard
              rows={
                round?.opponents.find((opponent) => opponent.seat !== mySlot)
                  ?.rows ?? []
              }
              fields={fields}
            />
          </>
        )}
      </div>
    </section>
  );
}

// EndedBoards 局末双方完整棋盘（答案已公开，历史猜测不再敏感，08 §4.5）；
// 与进行中一致：左右双栏、表头一次、同色同高。
function EndedBoards({
  roundResult,
  mySlot,
  fields,
}: {
  roundResult: RoundEndedPayload;
  mySlot: 1 | 2;
  fields?: readonly GuessField[];
}) {
  const toRows = (slot: 1 | 2): GuessRow[] => {
    const board = boardAtSeat(roundResult.boards, slot);
    return board.map((guess) => ({
      key: guess.guessId,
      name: guess.guessName,
      avatarUrl: guess.guessAvatarUrl,
      isCorrect: guess.isCorrect,
      cells: guess.feedback.map((field) => ({
        status: field.status,
        value: field.displayValue.join("、"),
      })),
    }));
  };
  return (
    <>
      <GuessTable
        title="我"
        rows={toRows(mySlot)}
        emptyLabel="本局未猜测。"
        fields={fields}
      />
      <GuessTable
        title="对手（局末揭示）"
        rows={toRows(mySlot === 1 ? 2 : 1)}
        emptyLabel="对手本局未猜测。"
        fields={fields}
      />
    </>
  );
}
