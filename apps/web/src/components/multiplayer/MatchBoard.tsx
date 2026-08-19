"use client";

// 对局视图：比分条后按单人模式的全宽台账依次展示自己与当前对手。
// 聊天与猜测操作由 RoomPage 的固定 command deck 统一承载。
import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
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
import { Paper, PaperButton, PaperSegmentSeparator } from "@/components/paper";
import { SectionHeading } from "../layout/SectionHeading";

type MatchView = NonNullable<RoomUiState["match"]>;
type RoundView = components["schemas"]["RoundView"];

export function MatchBoard({
  format,
  match,
  round,
  memberId,
  members,
  roundResult,
  roundActions,
  fields,
}: {
  format: string;
  match: MatchView;
  round: RoundView | null;
  memberId?: string | null;
  members?: components["schemas"]["MemberView"][];
  roundResult: RoundEndedPayload | null;
  roundActions?: ReactNode;
  fields?: readonly GuessField[];
}) {
  const remaining = useRoomClock(round?.deadline ?? null);
  const summaryDetailsId = useId();
  const [mobileSummaryOpen, setMobileSummaryOpen] = useState(false);

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
  const roundNumber = roundResult?.roundIndex ?? match.roundIndex;
  const roundDescription = placementScoring
    ? `剩余 ${activePlayers}/${rosterSize} 人`
    : match.targetWins > 1
      ? `先胜 ${match.targetWins} 局`
      : "一局定胜负";
  const roundExpired = Boolean(round && !ended && remaining <= 0);
  const timerText =
    round && !ended && !roundExpired ? formatRemaining(remaining) : null;
  const hasDetails = Boolean(showEliminationRule || (!ended && roundActions));

  return (
    <section className="multiplayer-match-page">
      <Paper
        animateOnMount={false}
        as="div"
        elevation="sm"
        className="multiplayer-match-summary"
        folded={false}
        pattern={false}
        sticker={false}
        unfoldOnHover={false}
      >
        <div className="multiplayer-match-summary-primary">
          <span className="multiplayer-match-mode">
            {placementScoring
              ? "积分制"
              : (ROOM_FORMAT_SHORT[format as keyof typeof ROOM_FORMAT_SHORT] ??
                format)}
          </span>
          <span className="multiplayer-match-round">
            <strong>第 {roundNumber} 局</strong>
            <span>{roundDescription}</span>
          </span>
          {timerText ? (
            <time
              aria-label={`本局剩余 ${timerText}`}
              className="multiplayer-match-clock tabular-nums"
              role="timer"
            >
              <small>本局剩余</small>
              {timerText}
            </time>
          ) : (
            <span className="multiplayer-match-clock multiplayer-match-ended">
              {roundExpired ? "等待结算" : "本局已结束"}
            </span>
          )}
          {hasDetails ? (
            <PaperButton
              ariaControls={summaryDetailsId}
              ariaExpanded={mobileSummaryOpen}
              ariaLabel={mobileSummaryOpen ? "收起对局信息" : "展开对局信息"}
              className="multiplayer-match-summary-toggle"
              compact
              folded={false}
              iconOnly
              onClick={() => setMobileSummaryOpen((open) => !open)}
              title={mobileSummaryOpen ? "收起对局信息" : "展开对局信息"}
            >
              <ChevronDown
                aria-hidden="true"
                className={mobileSummaryOpen ? "rotate-180" : ""}
                size={18}
              />
            </PaperButton>
          ) : null}
        </div>
        <div className="multiplayer-match-score-row">
          <MemberScoreStrip
            label="当前积分"
            members={members ?? []}
            scores={roundResult?.scores ?? match.scores}
            viewerMemberId={memberId}
            winnerMemberId={roundResult?.winnerMemberId}
          />
        </div>
        {hasDetails ? (
          <div
            className="multiplayer-match-summary-details"
            data-open={mobileSummaryOpen ? "true" : "false"}
            id={summaryDetailsId}
          >
            {showEliminationRule ? (
              <span
                className="multiplayer-elimination-rule"
                data-eliminates={eliminatesThisRound ? "true" : "false"}
              >
                {eliminatesThisRound ? "本局末位淘汰" : "本局不淘汰选手"}
              </span>
            ) : null}
            {!ended && roundActions ? (
              <div className="multiplayer-match-summary-actions">
                <PaperSegmentSeparator orientation="horizontal" />
                {roundActions}
              </div>
            ) : null}
          </div>
        ) : null}
      </Paper>

      {ended && roundResult ? (
        <div className="multiplayer-board-stack">
          <EndedBoards
            roundResult={roundResult}
            memberId={memberId}
            members={members ?? []}
            fields={fields}
          />
        </div>
      ) : (
        <div className="multiplayer-race-board-pair">
          <SelfBoard
            guesses={round?.self.guesses ?? []}
            playing={round?.status === "playing" && !roundExpired}
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
      getPageLabel={({ page, pageCount, visibleItems }) =>
        `${opponentLabel(visibleItems[0])} · ${page} / ${pageCount}`
      }
      items={opponents}
      label="对手棋盘"
      pageSize={1}
      renderHeader={({ controls, visibleItems }) => (
        <SectionHeading
          action={controls}
          className="member-paginator-header"
          description="仅显示反馈状态；具体角色与属性值将在局末揭示。"
          title={opponentLabel(visibleItems[0])}
        />
      )}
      renderItem={(opponent) => (
        <OpponentBoard
          rows={opponent.rows}
          fields={fields}
          fieldOrder={opponent.fieldOrder}
          showHeading={false}
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
