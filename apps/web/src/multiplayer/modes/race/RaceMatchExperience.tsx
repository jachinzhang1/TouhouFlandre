"use client";

import { Flag } from "lucide-react";
import { PaperButton } from "@/components/paper";
import { CountdownOverlay } from "../../../components/multiplayer/CountdownOverlay";
import { RoundResultOverlay } from "../../../components/multiplayer/RoundResultOverlay";
import { MatchResultOverlay } from "../../../components/multiplayer/MatchResultOverlay";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  GuessField,
  MultiParticipantRole,
  RoundEndedPayload,
} from "@touhouflandre/shared";
import {
  isActiveMatchMember,
  isRoundArchiveParticipant,
  resultForMemberId,
  sortMembersBySeat,
} from "../../../domain/memberCollections";
import type { components } from "../../../generated/api";
import type { RoomActions, RoomUiState } from "../../../hooks/useRoom";
import { GuessInputBar } from "../../../components/game/GuessInputBar";
import { GuessTable, type GuessRow } from "../../../components/game/GuessTable";
import {
  MatchBoard,
  MatchSummary,
} from "../../../components/multiplayer/MatchBoard";
import { MemberPaginator } from "../../../components/multiplayer/MemberPaginator";
import {
  boardResultBadges,
  formatBoardTitle,
} from "../../../components/multiplayer/boardMeta";
import { BoardBrowser, MultiplayerMatchFrame } from "../../framework";

type SpectatorBoardGuess =
  | components["schemas"]["GuessResult"]
  | RoundEndedPayload["boards"][number]["guesses"][number];

type SpectatorBoards = Array<{
  memberId: string;
  seat: number;
  guesses: SpectatorBoardGuess[];
}>;

export function RaceMatchExperience({
  state,
  format,
  fields,
  memberId,
  role,
  actions,
  onLeave,
  chat,
}: {
  state: RoomUiState;
  format: string;
  fields: readonly GuessField[];
  memberId: string | null;
  role: MultiParticipantRole | null;
  actions: RoomActions;
  onLeave: () => void;
  chat?: ReactNode;
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
        statusMessage={raceReadOnly ? statusMessage : undefined}
      />
    ) : null;
  return (
    <div className="multiplayer-experience" data-race-match-experience>
      <MultiplayerMatchFrame
        navigation={
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
        }
        bottomDock={guessControl}
        chat={chat}
        summary={
          <MatchSummary
            format={format}
            match={match}
            round={round}
            members={state.members}
            memberId={memberId}
            roundResult={selectedArchive ?? state.roundResult}
            roundActions={statusActions}
            viewLabel={
              spectator ? "观战席" : eliminated ? "已淘汰 · 观战" : undefined
            }
          />
        }
      >
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
            match={match}
            round={round}
            memberId={memberId}
            members={state.members}
            roundResult={selectedArchive ?? state.roundResult}
            fields={fields}
          />
        )}
      </MultiplayerMatchFrame>
      <div className="multiplayer-state-overlays">
        {countdownTarget && !showRoundOutcome ? (
          <CountdownOverlay startsAt={countdownTarget} />
        ) : null}

        {matchFinished && state.matchResult ? (
          <MatchResultOverlay
            result={state.matchResult}
            memberId={memberId}
            members={state.members}
            format={format}
            rematchReady={state.rematchReady}
            onRematch={actions.rematch}
            onLeave={onLeave}
          />
        ) : null}

        {showRoundOutcome && outcome ? (
          <RoundResultOverlay
            key={`${outcome.matchIndex}:${outcome.roundIndex}`}
            result={outcome}
            memberId={memberId}
            members={state.members}
            nextRoundStartsAt={countdownTarget ?? null}
            autoDismissAtCountdownEnd
          />
        ) : null}
      </div>
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
    <PaperButton
      onClick={() => void onClick()}
      disabled={busy}
      title={confirm ? "再次点击确认放弃本局" : "放弃本局"}
      className="single-game-forfeit race-forfeit-button"
      tone="danger"
      filled
    >
      <Flag size={18} aria-hidden="true" />
      {busy ? "提交中……" : confirm ? "再次点击确认放弃" : "放弃本局"}
    </PaperButton>
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
