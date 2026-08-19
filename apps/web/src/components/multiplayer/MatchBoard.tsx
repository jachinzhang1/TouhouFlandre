"use client";

// 对局视图：比分条后按单人模式的全宽台账依次展示自己与当前对手。
// 聊天与猜测操作由 RoomPage 的固定 command deck 统一承载。
import type { ReactNode } from "react";
import type { components } from "../../generated/api";
import type { GuessField, RoundEndedPayload } from "@touhouflandre/shared";
import { useRoomClock, formatRemaining } from "../../hooks/useRoomClock";
import { ROOM_FORMAT_SHORT } from "../../domain/multiRoom";
import {
  boardForMemberId,
  sortMembersBySeat,
} from "../../domain/memberCollections";
import { OpponentBoard } from "./OpponentBoard";
import { SelfBoard } from "./SelfBoard";
import { GuessTable, type GuessRow } from "../game/GuessTable";
import { MemberPaginator } from "./MemberPaginator";
import { MemberScoreStrip } from "./MemberScoreStrip";
import type { RoomUiState } from "../../hooks/useRoom";
import { Paper } from "@/components/paper";

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
  const activePlayers = match.scores.filter(
    (score) => score.status === undefined || score.status === "active",
  ).length;

  return (
    <section className="multiplayer-match-page">
      <Paper
        animateOnMount={false}
        as="div"
        elevation="sm"
        className="mb-3 flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
        folded={false}
        pattern={false}
        sticker={false}
        unfoldOnHover={false}
      >
        <span className="rounded bg-vermilion-soft px-2 py-0.5 text-[0.72rem] font-black text-vermilion">
          {placementScoring
            ? "积分制"
            : (ROOM_FORMAT_SHORT[format as keyof typeof ROOM_FORMAT_SHORT] ??
              format)}
        </span>
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
      </Paper>

      <div className="multiplayer-board-stack">
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
            <OpponentPages round={round} memberId={memberId} fields={fields} />
          </>
        )}
      </div>
    </section>
  );
}

function OpponentPages({
  round,
  memberId,
  fields,
}: {
  round: RoundView | null;
  memberId?: string | null;
  fields?: readonly GuessField[];
}) {
  const opponents = (round?.opponents ?? [])
    .filter((opponent) => opponent.memberId !== memberId)
    .sort((a, b) => a.seat - b.seat);
  return (
    <MemberPaginator
      items={opponents}
      label="对手棋盘"
      pageSize={1}
      renderItem={(opponent) => (
        <OpponentBoard
          rows={opponent.rows}
          fields={fields}
          fieldOrder={opponent.fieldOrder}
        />
      )}
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
    (board) => board.memberId === memberId,
  );
  const others = sortMembersBySeat(
    roundResult.boards.filter((board) => board.memberId !== memberId),
  );
  return (
    <div className="multiplayer-board-stack">
      {selfBoard ? (
        <GuessTable
          title="我的棋盘"
          rows={toRows(selfBoard.memberId)}
          emptyLabel="本局未猜测。"
          fields={fields}
        />
      ) : null}
      <MemberPaginator
        items={others}
        label="其他玩家（局末揭示）"
        pageSize={1}
        renderItem={(board) => (
          <GuessTable
            title={
              members.find((member) => member.memberId === board.memberId)
                ?.displayName ?? `玩家 ${board.seat}`
            }
            subtitle="局末已揭示完整猜测记录。"
            rows={toRows(board.memberId)}
            emptyLabel="该玩家本局未猜测。"
            fields={fields}
            highlight={roundResult.winnerMemberId === board.memberId}
          />
        )}
      />
    </div>
  );
}
