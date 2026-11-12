"use client";

// 对局视图：比分条后按单人模式的全宽台账依次展示自己与当前对手。
// 聊天与猜测操作由 RoomPage 的固定底部栏分别承载。
import type { ReactNode } from "react";
import type { components } from "../../generated/api";
import type { GuessField, RoundEndedPayload } from "@touhouflandre/shared";
import { useRoomClock, formatRemaining } from "../../hooks/useRoomClock";
import { ROOM_FORMAT_SHORT } from "../../domain/multiRoom";
import {
  boardForMemberId,
  isActiveMatchMember,
  isRoundArchiveParticipant,
  sortMembersBySeat,
} from "../../domain/memberCollections";
import { OpponentBoard } from "./OpponentBoard";
import { SelfBoard } from "./SelfBoard";
import { GuessTable, type GuessRow } from "../game/GuessTable";
import { MemberPaginator } from "./MemberPaginator";
import { MemberScoreStrip } from "./MemberScoreStrip";
import type { RoomUiState } from "../../hooks/useRoom";
import { boardResultBadges, formatBoardTitle } from "./boardMeta";

type MatchView = NonNullable<RoomUiState["match"]>;
type RoundView = components["schemas"]["RoundView"];

export function MatchSummary({
  format,
  match,
  round,
  memberId,
  members,
  roundResult,
  roundActions,
  viewLabel,
}: {
  format: string;
  match: MatchView;
  round: RoundView | null;
  memberId?: string | null;
  members?: components["schemas"]["MemberView"][];
  roundResult: RoundEndedPayload | null;
  roundActions?: ReactNode;
  viewLabel?: string;
}) {
  const remaining = useRoomClock(round?.deadline ?? null);
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
  const roundExpired = Boolean(round && !ended && remaining <= 0);

  const roundLabel = `第 ${roundResult?.roundIndex ?? match.roundIndex} 局`;
  const modeLabel = placementScoring
    ? "积分制"
    : match.scoringMode === "points"
      ? "积分累计"
      : (ROOM_FORMAT_SHORT[format as keyof typeof ROOM_FORMAT_SHORT] ?? format);
  const progressLabel = placementScoring
    ? `剩余 ${activePlayers}/${rosterSize} 人`
    : match.scoringMode === "points"
      ? `共 ${match.maxRounds} 局`
      : match.targetWins > 1
        ? `先胜 ${match.targetWins} 局`
        : modeLabel;

  return (
    <section
      aria-label="对局概览"
      className="status-strip multiplayer-room-summary"
    >
      <div className="puzzle-status">
        <span className="label">{modeLabel}</span>
        {viewLabel ? <span className="label">{viewLabel}</span> : null}
        <strong className="single-game-puzzle-title">{roundLabel}</strong>
      </div>
      <MemberScoreStrip
        members={members ?? []}
        scores={roundResult?.scores ?? match.scores}
        viewerMemberId={memberId}
        winnerMemberId={roundResult?.winnerMemberId}
      />
      <dl className="single-game-metrics multiplayer-room-metrics">
        <div>
          <dt>本局剩余</dt>
          <dd
            aria-label={`本局剩余 ${formatRemaining(remaining)}`}
            className="multiplayer-room-clock tabular-nums"
            role={round && !ended ? "timer" : undefined}
          >
            {round && !ended
              ? roundExpired
                ? "等待结算"
                : formatRemaining(remaining)
              : "已结束"}
          </dd>
        </div>
        <div>
          <dt>{showEliminationRule ? "淘汰规则" : "赛制"}</dt>
          <dd
            className={
              eliminatesThisRound
                ? "multiplayer-elimination-rule is-eliminating"
                : "multiplayer-elimination-rule"
            }
          >
            {showEliminationRule
              ? eliminatesThisRound
                ? "本局末位淘汰"
                : "本局不淘汰"
              : progressLabel}
          </dd>
        </div>
      </dl>
      <div className="status-actions">{!ended ? roundActions : null}</div>
    </section>
  );
}

export function MatchBoard({
  match,
  round,
  memberId,
  members,
  roundResult,
  fields,
}: {
  match: MatchView;
  round: RoundView | null;
  memberId?: string | null;
  members?: components["schemas"]["MemberView"][];
  roundResult: RoundEndedPayload | null;
  fields?: readonly GuessField[];
}) {
  const remaining = useRoomClock(round?.deadline ?? null);
  const ended = Boolean(roundResult);
  const roundExpired = Boolean(round && !ended && remaining <= 0);

  return (
    <section className="multiplayer-board-region">
      {ended && roundResult ? (
        <EndedBoards
          roundResult={roundResult}
          memberId={memberId}
          members={members ?? []}
          fields={fields}
        />
      ) : (
        <div className="multiplayer-room-board-grid">
          <OpponentPages
            round={round}
            memberId={memberId}
            match={match}
            members={members ?? []}
            fields={fields}
          />
          <SelfBoard
            guesses={round?.self.guesses ?? []}
            playing={round?.status === "playing" && !roundExpired}
            maxGuesses={round?.maxGuesses}
            fields={fields}
            showHeading={false}
          />
        </div>
      )}
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
    .sort((left, right) => left.seat - right.seat);
  const opponentLabel = (opponent: (typeof opponents)[number] | undefined) => {
    if (!opponent) return "对手棋盘";
    const member = members.find(
      (entry) => entry.memberId === opponent.memberId,
    );
    return `P${opponent.seat} ${member?.displayName ?? `玩家 ${opponent.seat}`}`;
  };
  return (
    <MemberPaginator
      controlsPlacement="item"
      getPageLabel={({ page, pageCount, visibleItems }) =>
        `${opponentLabel(visibleItems[0])} · ${page} / ${pageCount}`
      }
      items={opponents}
      label="对手棋盘"
      pageSize={1}
      renderItem={(opponent, controls) => (
        <OpponentBoard
          title={opponentLabel(opponent)}
          rows={opponent.rows}
          fields={fields}
          fieldOrder={opponent.fieldOrder}
          headerExtra={controls}
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
      matchKind: guess.matchKind,
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
    <div className="multiplayer-board-stack">
      {selfBoard ? (
        <GuessTable
          title="我的棋盘"
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
              title={formatBoardTitle(
                members.find((member) => member.memberId === board.memberId),
                board.seat,
              )}
              subtitle="局末已揭示完整猜测记录。"
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
