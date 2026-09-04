"use client";

import { Flag } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  GuessField,
  MatchEndedPayload,
  MultiParticipantRole,
  RoundEndedPayload,
} from "@touhouflandre/shared";
import {
  isActiveMatchMember,
  isRoundArchiveParticipant,
  resultForMemberId,
  sortMembersBySeat,
} from "../../../domain/memberCollections";
import { ROOM_FORMAT_SHORT } from "../../../domain/multiRoom";
import type { components } from "../../../generated/api";
import type { RoomActions, RoomUiState } from "../../../hooks/useRoom";
import { formatRemaining, useRoomClock } from "../../../hooks/useRoomClock";
import { GuessInputBar } from "../../../components/game/GuessInputBar";
import { GuessTable, type GuessRow } from "../../../components/game/GuessTable";
import { MatchBoard } from "../../../components/multiplayer/MatchBoard";
import { MemberPaginator } from "../../../components/multiplayer/MemberPaginator";
import { memberScoreEntries } from "../../../components/multiplayer/MemberScoreStrip";
import {
  boardResultBadges,
  formatBoardTitle,
} from "../../../components/multiplayer/boardMeta";
import {
  BoardBrowser,
  MatchCountdownBand,
  MatchFinishedBand,
  MatchOutcomeBand,
  MatchStatusBand,
  MatchSummaryBar,
  MultiplayerMatchFrame,
  type MatchRankingEntry,
} from "../../framework";

type SpectatorBoardGuess =
  | components["schemas"]["GuessResult"]
  | RoundEndedPayload["boards"][number]["guesses"][number];

type SpectatorBoards = Array<{
  memberId: string;
  seat: number;
  guesses: SpectatorBoardGuess[];
}>;

const REASON_LABEL: Record<string, string> = {
  normal: "正常完赛",
  forfeit: "有玩家弃赛",
  disconnect: "有玩家断线",
  server_restart: "服务重启",
  round_cap: "局数上限",
  insufficient_active_players: "人数不足",
};

export function RaceMatchExperience({
  state,
  format,
  fields,
  memberId,
  role,
  actions,
  onLeave,
}: {
  state: RoomUiState;
  format: string;
  fields: readonly GuessField[];
  memberId: string | null;
  role: MultiParticipantRole | null;
  actions: RoomActions;
  onLeave: () => void;
}) {
  const [forfeitConfirm, setForfeitConfirm] = useState(false);
  const [roundActionBusy, setRoundActionBusy] = useState(false);
  const [selectedArchiveKey, setSelectedArchiveKey] = useState<string | null>(
    null,
  );
  const match = state.match;
  const round = state.round;
  const roomStatus = state.room?.status;
  const viewerStatus = match?.scores.find(
    (score) => score.memberId === memberId,
  )?.status;
  const eliminated = role === "player" && viewerStatus === "eliminated";
  const spectator = role === "spectator";
  const readOnlyViewer = spectator || eliminated;
  const currentArchives = useMemo(
    () =>
      state.roundArchives.filter(
        (archive) => archive.matchIndex === match?.matchIndex,
      ),
    [match?.matchIndex, state.roundArchives],
  );
  const selectedArchive =
    currentArchives.find(
      (archive) => archiveKey(archive) === selectedArchiveKey,
    ) ?? null;
  const latestArchive = currentArchives.at(-1) ?? null;
  const displayArchive =
    selectedArchive ??
    (readOnlyViewer &&
    (roomStatus === "finished" || round?.status === "ended" || !round)
      ? latestArchive
      : null);
  const effectiveArchiveKey = displayArchive
    ? archiveKey(displayArchive)
    : null;
  const retentionRemaining = useRoomClock(
    roomStatus === "finished"
      ? (state.matchResult?.retentionEndsAt ?? state.room?.expiresAt)
      : null,
  );

  useEffect(() => {
    setSelectedArchiveKey(null);
  }, [match?.matchIndex]);

  useEffect(() => {
    setForfeitConfirm(false);
    setRoundActionBusy(false);
  }, [match?.matchIndex, match?.roundIndex, round?.status]);

  useEffect(() => {
    if (!forfeitConfirm) return;
    const timeout = window.setTimeout(() => setForfeitConfirm(false), 4000);
    return () => window.clearTimeout(timeout);
  }, [forfeitConfirm]);

  if (!match) return null;

  const scoringMode = match.scoringMode ?? "wins";
  const rosterSize = match.rosterSize ?? match.scores.length;
  const activePlayers = match.scores.filter(
    (score) => score.status === undefined || score.status === "active",
  ).length;
  const eliminatesThisRound =
    scoringMode === "placement" &&
    match.roundIndex >= Math.floor(rosterSize / 2) &&
    rosterSize > 2;
  const ruleLabel = raceRuleLabel(scoringMode, format);
  const progressDetail = raceProgressDetail(
    scoringMode,
    match,
    activePlayers,
    rosterSize,
  );
  const participationMessage = raceParticipationMessage(
    round?.self.participationStatus,
    roundActionBusy,
  );
  const historyScope = effectiveArchiveKey
    ? `archive:${effectiveArchiveKey}`
    : "current";
  const outcome = state.roundResult;
  const matchFinished = Boolean(roomStatus === "finished" && state.matchResult);
  const showRoundOutcome = Boolean(
    outcome && !selectedArchive && roomStatus !== "finished",
  );
  const countdownTarget =
    roomStatus === "finished" || selectedArchive
      ? null
      : round?.status === "countdown"
        ? round.startsAt
        : outcome?.nextStartsAt
          ? outcome.nextStartsAt
          : null;
  const initialCountdown = Boolean(countdownTarget && !outcome);
  const raceReadOnly = Boolean(participationMessage) || readOnlyViewer;
  const hasOpponent = state.members.length >= 2;
  const guessedIds = new Set(
    round?.self.guesses.map((guess) => guess.guessId) ?? [],
  );
  const statusMessage = selectedArchive
    ? `正在查看第 ${selectedArchive.roundIndex} 局历史`
    : spectator
      ? "只读观战，可以浏览所有玩家棋盘"
      : eliminated
        ? "你已淘汰，可以继续浏览所有玩家棋盘"
        : (participationMessage ?? "竞速进行中");
  const statusActions =
    roomStatus === "finished" ? undefined : readOnlyViewer ? (
      <button
        type="button"
        onClick={onLeave}
        className="min-h-8 rounded-[5px] border border-line-strong bg-paper px-3 text-[0.72rem] font-bold"
      >
        退出房间
      </button>
    ) : round?.status === "playing" && !raceReadOnly && !selectedArchive ? (
      <RoundForfeitButton
        confirm={forfeitConfirm}
        busy={roundActionBusy}
        onClick={async () => {
          if (!forfeitConfirm) {
            setForfeitConfirm(true);
            return;
          }
          setForfeitConfirm(false);
          setRoundActionBusy(true);
          try {
            await actions.forfeitRound();
          } finally {
            setRoundActionBusy(false);
          }
        }}
      />
    ) : undefined;

  const summaryModel = {
    identityLabel: `竞速 · ${ruleLabel}`,
    scoreEntries: memberScoreEntries({
      members: state.members,
      scores: state.matchResult?.scores ?? match.scores,
      viewerMemberId: memberId,
      winnerMemberId: state.matchResult?.winnerMemberId,
    }),
    progressLabel: `第 ${match.roundIndex} 局${progressDetail ? ` · ${progressDetail}` : ""}`,
    indicators: readOnlyViewer ? (
      <span className={eliminated ? "text-vermilion" : "text-jade"}>
        {eliminated ? "已淘汰 · 观战" : "观战席"}
      </span>
    ) : scoringMode === "placement" ? (
      <span className={eliminatesThisRound ? "text-vermilion" : "text-jade"}>
        {eliminatesThisRound ? "本局末位淘汰" : "本局不淘汰选手"}
      </span>
    ) : undefined,
  };
  const statusModel = {
    message: statusMessage,
    active: !selectedArchive && !raceReadOnly && round?.status === "playing",
    timers:
      !selectedArchive && round?.status === "playing"
        ? [{ label: "本局", deadline: round.deadline }]
        : undefined,
  };
  const guessControl =
    role === "player" &&
    !eliminated &&
    round?.status === "playing" &&
    !selectedArchive ? (
      <GuessInputBar
        onGuess={actions.submitGuess}
        disabled={!hasOpponent || raceReadOnly}
        searchContext={
          state.room
            ? {
                kind: "multiplayer-match",
                roomId: state.room.roomId,
                matchIndex: match.matchIndex,
              }
            : undefined
        }
        guessedIds={guessedIds}
      />
    ) : null;
  const bottomControls = guessControl ? (
    <div className="race-bottom-controls">
      {guessControl}
      <MatchSummaryBar model={summaryModel} />
      {!matchFinished ? (
        <MatchStatusBand model={statusModel} actions={statusActions} />
      ) : null}
    </div>
  ) : undefined;

  return (
    <div data-race-match-experience>
      <MultiplayerMatchFrame bottomDock={bottomControls}>
        {!bottomControls ? <MatchSummaryBar model={summaryModel} /> : null}

        {countdownTarget ? (
          <MatchCountdownBand
            targetAt={countdownTarget}
            label={initialCountdown ? "对局" : "下一局"}
            kind={initialCountdown ? "initial" : "intermission"}
          />
        ) : null}

        {matchFinished && state.matchResult ? (
          <MatchFinishedBand
            title="对局结果"
            subtitle={`${ruleLabel} · ${REASON_LABEL[state.matchResult.reason] ?? state.matchResult.reason} · 房间保留 ${formatRemaining(retentionRemaining)}`}
            ranking={raceRankingEntries(
              state.matchResult,
              state.members,
              memberId,
            )}
            ready={state.rematchReady.some(
              (entry) => entry.memberId === memberId && entry.ready,
            )}
            readyLabel={rematchLabel(state.rematchReady, memberId)}
            onRematch={actions.rematch}
            onLeave={onLeave}
          />
        ) : null}

        {showRoundOutcome && outcome ? (
          <RaceRoundOutcome
            result={outcome}
            members={state.members}
            viewerMemberId={memberId}
          />
        ) : null}

        {!bottomControls && !matchFinished ? (
          <MatchStatusBand model={statusModel} actions={statusActions} />
        ) : null}

        <BoardBrowser
          model={{
            ariaLabel: "竞速棋盘导航",
            returnLabel: "返回当前局",
            currentScopeId: "current",
            selectedScopeId: historyScope,
            scopeLabel: "选择局次",
            scopeOptions: [
              { id: "current", label: "当前局" },
              ...currentArchives.map((archive) => ({
                id: `archive:${archiveKey(archive)}`,
                label: `第 ${archive.roundIndex} 局 · ${archiveResultLabel(archive, memberId)}`,
              })),
            ],
          }}
          onScopeChange={(scopeId) => {
            setSelectedArchiveKey(
              scopeId === "current" ? null : scopeId.slice("archive:".length),
            );
          }}
        />

        {readOnlyViewer ? (
          <SpectatorRaceBoards
            boards={displayArchive?.boards ?? round?.boards ?? []}
            scores={match.scores}
            members={state.members}
            fields={fields}
            archive={displayArchive}
          />
        ) : (
          <MatchBoard
            embedded
            format={format}
            match={match}
            round={round}
            memberId={memberId}
            members={state.members}
            roundResult={selectedArchive ?? state.roundResult}
            onGuess={actions.submitGuess}
            disabled={!hasOpponent}
            fields={fields}
          />
        )}
      </MultiplayerMatchFrame>
    </div>
  );
}

function RoundForfeitButton({
  confirm,
  busy,
  onClick,
}: {
  confirm: boolean;
  busy: boolean;
  onClick: () => void | Promise<void>;
}) {
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={busy}
      title={confirm ? "再次点击确认放弃本局" : "放弃本局"}
      className="race-forfeit-button inline-flex min-h-12 w-[148px] items-center justify-center gap-2 border-0 bg-vermilion px-4 text-sm font-bold text-[var(--accent-contrast)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Flag size={18} aria-hidden="true" />
      {busy ? "提交中……" : confirm ? "再次点击确认放弃" : "放弃本局"}
    </button>
  );
}

function RaceRoundOutcome({
  result,
  members,
  viewerMemberId,
}: {
  result: RoundEndedPayload;
  members: readonly components["schemas"]["MemberView"][];
  viewerMemberId: string | null;
}) {
  const viewerResult =
    result.viewerResult ??
    resultForMemberId(result.results, viewerMemberId) ??
    "draw";
  const tone =
    viewerResult === "win"
      ? ("success" as const)
      : viewerResult === "loss"
        ? ("danger" as const)
        : ("default" as const);
  return (
    <MatchOutcomeBand
      eyebrow={`ROUND ${result.roundIndex}`}
      title={`${viewerResult === "win" ? "本局获胜" : viewerResult === "loss" ? "本局失利" : "本局平局"} · 答案：${result.answer.name}`}
      tone={tone}
      detail={`当前比分 ${sortMembersBySeat(result.scores)
        .map((entry) => entry.score)
        .join(" : ")}`}
    >
      <ul className="mt-2 mb-0 flex flex-wrap gap-1.5" aria-label="本局结果">
        {sortMembersBySeat(result.results).map((entry) => {
          const score =
            result.scores.find((item) => item.memberId === entry.memberId)
              ?.score ?? 0;
          return (
            <li
              key={entry.memberId}
              className={`rounded border px-2 py-1 text-[0.7rem] ${entry.memberId === viewerMemberId ? "border-vermilion bg-paper" : "border-line bg-paper-muted"}`}
            >
              {memberLabel(entry, members, viewerMemberId)} · {score} 分 ·{" "}
              {resultLabel(entry.result)}
            </li>
          );
        })}
      </ul>
    </MatchOutcomeBand>
  );
}

function SpectatorRaceBoards({
  boards,
  scores,
  members,
  fields,
  archive,
}: {
  boards: SpectatorBoards;
  scores?: NonNullable<RoomUiState["match"]>["scores"];
  members: readonly components["schemas"]["MemberView"][];
  fields: readonly GuessField[];
  archive: RoundEndedPayload | null;
}) {
  const visibleBoards = archive
    ? boards.filter((board) =>
        isRoundArchiveParticipant(archive, board.memberId),
      )
    : boards.filter((board) => isActiveMatchMember(scores, board.memberId));
  const ordered = [...visibleBoards].sort(
    (left, right) => left.seat - right.seat,
  );
  const rowsFor = (boardMemberId: string): GuessRow[] => {
    const rows =
      boards.find((entry) => entry.memberId === boardMemberId)?.guesses ?? [];
    const guesses: GuessRow[] = rows.map((guess, index) => ({
      key: `${boardMemberId}:${guess.guessId}:${index}`,
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
    if (archive?.forfeitedMemberId === boardMemberId) {
      guesses.push({
        key: `${boardMemberId}:forfeit:${archive.matchIndex}:${archive.roundIndex}`,
        notice: "玩家放弃此局",
        tone: "danger",
      });
    }
    return guesses;
  };

  return (
    <MemberPaginator
      items={ordered}
      label="玩家棋盘"
      renderItem={(board) => {
        const winner = archive?.winnerMemberId === board.memberId;
        const eliminated = Boolean(
          archive?.eliminatedMemberIds?.includes(board.memberId),
        );
        return (
          <GuessTable
            title={formatBoardTitle(
              members.find((member) => member.memberId === board.memberId),
              board.seat,
            )}
            subtitle={archive ? `第 ${archive.roundIndex} 局记录` : "实时棋盘"}
            headerExtra={boardResultBadges({ winner, eliminated })}
            rows={rowsFor(board.memberId)}
            emptyLabel="该玩家暂无猜测。"
            fields={fields}
            highlight={winner || eliminated}
            highlightTone={eliminated ? "danger" : "success"}
          />
        );
      }}
    />
  );
}

function raceRankingEntries(
  result: MatchEndedPayload,
  members: readonly components["schemas"]["MemberView"][],
  viewerMemberId: string | null,
): MatchRankingEntry[] {
  if (result.ranking?.length) {
    return result.ranking.map((entry) => ({
      id: entry.memberId,
      rank: entry.rank,
      order: entry.rank * 100 + entry.seat,
      label: memberLabel(entry, members, viewerMemberId),
      scoreLabel: `${entry.score} 分${entry.eliminatedRound ? ` · 第 ${entry.eliminatedRound} 局淘汰` : entry.status === "left" ? " · 离场" : ""}`,
      isViewer: entry.memberId === viewerMemberId,
    }));
  }
  return sortMembersBySeat(result.results).map((entry) => ({
    id: entry.memberId,
    rankLabel: resultLabel(entry.result),
    order: entry.seat,
    label: memberLabel(entry, members, viewerMemberId),
    scoreLabel: `${result.scores.find((score) => score.memberId === entry.memberId)?.score ?? 0} 分`,
    isViewer: entry.memberId === viewerMemberId,
  }));
}

function raceRuleLabel(scoringMode: string, format: string) {
  if (scoringMode === "placement") return "积分淘汰";
  if (scoringMode === "points") return "积分累计";
  return ROOM_FORMAT_SHORT[format as keyof typeof ROOM_FORMAT_SHORT] ?? format;
}

function raceProgressDetail(
  scoringMode: string,
  match: NonNullable<RoomUiState["match"]>,
  activePlayers: number,
  rosterSize: number,
) {
  if (scoringMode === "placement") {
    return `剩余 ${activePlayers}/${rosterSize} 人`;
  }
  if (scoringMode === "points") return `共 ${match.maxRounds} 局`;
  return match.targetWins > 1 ? `先胜 ${match.targetWins} 局` : "";
}

function raceParticipationMessage(
  status: components["schemas"]["RaceRoundParticipantStatus"] | undefined,
  busy: boolean,
) {
  if (busy) return "正在放弃本局……";
  if (status === "forfeited") return "你已放弃本局";
  if (status === "correct") return "你已猜中本局";
  if (status === "exhausted") return "本局猜测次数已用尽";
  if (status === "timed_out") return "本局已超时";
  return null;
}

function rematchLabel(
  ready: readonly { memberId: string; ready: boolean }[],
  viewerMemberId: string | null,
) {
  const mine = ready.some(
    (entry) => entry.memberId === viewerMemberId && entry.ready,
  );
  const count = ready.filter((entry) => entry.ready).length;
  return mine ? `已确认 ${count}` : "再来一局";
}

function archiveKey(
  archive: Pick<RoundEndedPayload, "matchIndex" | "roundIndex">,
) {
  return `${archive.matchIndex}:${archive.roundIndex}`;
}

function archiveResultLabel(
  archive: RoundEndedPayload,
  viewerMemberId: string | null,
) {
  const placement = archive.placements?.find(
    (entry) => entry.memberId === viewerMemberId,
  );
  if (placement) {
    return `+${placement.pointsAwarded} 分${archive.eliminatedMemberIds?.includes(viewerMemberId ?? "") ? " · 已淘汰" : ""}`;
  }
  return resultLabel(
    archive.viewerResult ??
      resultForMemberId(archive.results, viewerMemberId) ??
      "draw",
  );
}

function resultLabel(result: string) {
  return result === "win" ? "胜" : result === "loss" ? "负" : "平";
}

function memberLabel(
  entry: { memberId: string; seat: number },
  members: readonly components["schemas"]["MemberView"][],
  viewerMemberId: string | null,
) {
  const name =
    members.find((member) => member.memberId === entry.memberId)?.displayName ??
    `玩家 ${entry.seat}`;
  return `${name}(${entry.memberId === viewerMemberId ? "我" : `P${entry.seat}`})`;
}
