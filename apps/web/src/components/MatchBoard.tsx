"use client";

// 对局视图（08 §10.2 布局调整）：比分条 + 双棋盘左右排布（左自己、右对手；
// 窄屏 max-[680px] 堆叠为上下）。搜索输入在底部固定条（GuessInputBar）。
import type { ReactNode } from "react";
import type { components } from "../generated/api";
import type { GuessField, RoundEndedPayload } from "@touhouflandre/shared";
import { useRoomClock, formatRemaining } from "../hooks/useRoomClock";
import { ROOM_FORMAT_SHORT } from "../domain/multiRoom";
import {
  boardForMemberId,
  isActiveMatchMember,
  isRoundArchiveParticipant,
  sortMembersBySeat,
} from "../domain/memberCollections";
import { OpponentBoard } from "./OpponentBoard";
import { SelfBoard } from "./SelfBoard";
import { GuessTable, type GuessRow } from "./GuessTable";
import { MemberPaginator } from "./MemberPaginator";
import { MemberScoreStrip } from "./MemberScoreStrip";
import { boardResultBadges, formatBoardTitle } from "./boardMeta";
import type { RoomUiState } from "../hooks/useRoom";

type MatchView = NonNullable<RoomUiState["match"]>;
type RoundView = components["schemas"]["RoundView"];

export function MatchBoard({
  format,
  match,
  round,
  memberId,
  members,
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
  memberId?: string | null;
  members?: components["schemas"]["MemberView"][];
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
  const placementScoring = match.scoringMode === "placement";
  const rosterSize = match.rosterSize ?? match.scores.length;
  const activePlayers = match.scores.filter(
    (score) => score.status === undefined || score.status === "active",
  ).length;
  const eliminationThreshold = Math.floor(rosterSize / 2);
  const showEliminationRule =
    placementScoring && Boolean(round) && !ended && rosterSize > 2;
  const eliminatesThisRound =
    showEliminationRule && match.roundIndex >= eliminationThreshold;

  return (
    <section className="px-[18px] pt-5 pb-28">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-line bg-paper px-4 py-2.5 shadow-sm">
        <span className="rounded bg-vermilion-soft px-2 py-0.5 text-[0.72rem] font-black text-vermilion">
          {placementScoring
            ? "积分制"
            : (ROOM_FORMAT_SHORT[format as keyof typeof ROOM_FORMAT_SHORT] ??
              format)}
        </span>
        {showEliminationRule ? (
          <span
            className={`rounded px-2 py-0.5 text-[0.72rem] font-black ${
              eliminatesThisRound
                ? "bg-vermilion-soft text-vermilion"
                : "bg-jade-soft text-jade"
            }`}
          >
            {eliminatesThisRound ? "本局末位淘汰" : "本局不淘汰选手"}
          </span>
        ) : null}
        <MemberScoreStrip
          members={members ?? []}
          scores={roundResult?.scores ?? match.scores}
          viewerMemberId={memberId}
          winnerMemberId={roundResult?.winnerMemberId}
        />
        <span className="text-[0.75rem] text-ink-soft">
          第 {roundResult?.roundIndex ?? match.roundIndex} 局
          {placementScoring
            ? ` · 剩余 ${activePlayers}/${match.rosterSize ?? match.scores.length} 人`
            : match.targetWins > 1
              ? ` · 先胜 ${match.targetWins} 局`
              : ""}
        </span>
        {round && !ended && (
          <span className="text-[0.72rem] text-ink-soft tabular-nums">
            剩余 {formatRemaining(remaining)}
          </span>
        )}
        {!ended ? roundActions : null}
      </div>

      <div
        className={`grid items-start gap-3 max-[900px]:grid-cols-1 ${
          ended ? "grid-cols-1" : "grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"
        }`}
      >
        {ended && roundResult ? (
          <EndedBoards
            roundResult={roundResult}
            memberId={memberId}
            members={members ?? []}
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
            <OpponentPages
              round={round}
              memberId={memberId}
              match={match}
              members={members ?? []}
              fields={fields}
            />
          </>
        )}
      </div>
    </section>
  );
}

function OpponentPages({
  round,
  memberId,
  match,
  members,
  fields,
}: {
  round: RoundView | null;
  memberId?: string | null;
  match: MatchView;
  members: components["schemas"]["MemberView"][];
  fields?: readonly GuessField[];
}) {
  const opponents = (round?.opponents ?? [])
    .filter(
      (opponent) =>
        opponent.memberId !== memberId &&
        isActiveMatchMember(match.scores, opponent.memberId),
    )
    .sort((a, b) => a.seat - b.seat);
  return (
    <MemberPaginator
      items={opponents}
      label="对手棋盘"
      pageSize={1}
      renderItem={(opponent) => {
        const member = members.find(
          (entry) => entry.memberId === opponent.memberId,
        );
        return (
          <OpponentBoard
            title={formatBoardTitle(member, opponent.seat)}
            rows={opponent.rows}
            fields={fields}
            fieldOrder={opponent.fieldOrder}
          />
        );
      }}
    />
  );
}

// EndedBoards 局末双方完整棋盘（答案已公开，历史猜测不再敏感，08 §4.5）；
// 与进行中一致：左右双栏、表头一次、同色同高。
function EndedBoards({
  roundResult,
  memberId,
  members,
  fields,
}: {
  roundResult: RoundEndedPayload;
  memberId?: string | null;
  members: components["schemas"]["MemberView"][];
  fields?: readonly GuessField[];
}) {
  const toRows = (boardMemberId: string): GuessRow[] => {
    const board = boardForMemberId(roundResult.boards, boardMemberId);
    return board.map((guess) => ({
      key: guess.guessId,
      name: guess.guessName,
      avatarUrl: guess.guessAvatarUrl,
      isCorrect: guess.isCorrect,
      cells: guess.feedback.map((field) => ({
        field: field.field,
        status: field.status,
        value: field.displayValue.join("、"),
      })),
    }));
  };
  const selfBoard = roundResult.boards.find(
    (board) =>
      board.memberId === memberId &&
      isRoundArchiveParticipant(roundResult, board.memberId),
  );
  const selfEliminated = Boolean(
    selfBoard && roundResult.eliminatedMemberIds?.includes(selfBoard.memberId),
  );
  const selfWinner = Boolean(
    selfBoard && roundResult.winnerMemberId === selfBoard.memberId,
  );
  const others = sortMembersBySeat(
    roundResult.boards.filter(
      (board) =>
        board.memberId !== memberId &&
        isRoundArchiveParticipant(roundResult, board.memberId),
    ),
  );
  return (
    <div className="grid min-w-0 items-start gap-3 min-[900px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      {selfBoard ? (
        <GuessTable
          title="我"
          headerExtra={boardResultBadges({
            winner: selfWinner,
            eliminated: selfEliminated,
          })}
          rows={toRows(selfBoard.memberId)}
          emptyLabel="本局未猜测。"
          fields={fields}
          highlight={selfWinner || selfEliminated}
          highlightTone={selfEliminated ? "danger" : "success"}
        />
      ) : null}
      <MemberPaginator
        items={others}
        label="其他玩家（局末揭示）"
        pageSize={1}
        renderItem={(board) => {
          const eliminated = Boolean(
            roundResult.eliminatedMemberIds?.includes(board.memberId),
          );
          const winner = roundResult.winnerMemberId === board.memberId;
          return (
            <GuessTable
              title={
                formatBoardTitle(
                  members.find((member) => member.memberId === board.memberId),
                  board.seat,
                )
              }
              headerExtra={boardResultBadges({ winner, eliminated })}
              rows={toRows(board.memberId)}
              emptyLabel="该玩家本局未猜测。"
              fields={fields}
              highlight={winner || eliminated}
              highlightTone={eliminated ? "danger" : "success"}
            />
          );
        }}
      />
    </div>
  );
}
