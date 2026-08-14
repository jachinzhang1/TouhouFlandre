"use client";

import { FastForward, Flag } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CHARACTER_GUESS_FIELDS,
  visibleQuestionFields,
  type GuessField,
  type RoundEndedPayload,
} from "@touhouflandre/shared";
import type { components } from "../generated/api";
import {
  clearMultiRoom,
  loadMultiRoom,
  MULTIPLAYER_MODE_LABELS,
  normalizeRoomCode,
  relaySkipRemaining,
  ROOM_FORMAT_SHORT,
  saveMultiRoom,
} from "../domain/multiRoom";
import type { StoredMultiRoom } from "../domain/multiRoom";
import {
  resultForMemberId,
  seatForMemberId,
} from "../domain/memberCollections";
import { useRoom, type RoomUiState } from "../hooks/useRoom";
import { useRoomClock, formatRemaining } from "../hooks/useRoomClock";
import { api } from "../lib/api";
import { migrateLegacyMultiplayerDraft } from "../stats/multiplayerRecorder";
import { CountdownOverlay } from "./CountdownOverlay";
import { GuessInputBar } from "./GuessInputBar";
import { GuessTable, type GuessRow } from "./GuessTable";
import { MatchBoard } from "./MatchBoard";
import { MatchResultOverlay } from "./MatchResultOverlay";
import { MemberPaginator } from "./MemberPaginator";
import { MemberScoreStrip } from "./MemberScoreStrip";
import { RelayMatchBoard } from "./RelayMatchBoard";
import { RoomLobby } from "./RoomLobby";
import { RoundResultOverlay } from "./RoundResultOverlay";

type SpectatorBoardGuess =
  | components["schemas"]["GuessResult"]
  | RoundEndedPayload["boards"][number]["guesses"][number];

type SpectatorBoards = Array<{
  memberId: string;
  seat: number;
  guesses: SpectatorBoardGuess[];
}>;

export function RoomView({ code }: { code: string }) {
  const router = useRouter();
  const normalized = normalizeRoomCode(code);
  const [stored, setStored] = useState<StoredMultiRoom | null | undefined>(
    undefined,
  );
  const [redirecting, setRedirecting] = useState(false);
  const [forfeitConfirm, setForfeitConfirm] = useState(false);
  const [roundActionBusy, setRoundActionBusy] = useState<
    "forfeit" | "pass" | null
  >(null);
  const [dismissedRoundResultKey, setDismissedRoundResultKey] = useState<
    string | null
  >(null);
  const [selectedArchiveKey, setSelectedArchiveKey] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setStored(loadMultiRoom());
  }, []);

  useEffect(() => {
    if (stored === undefined) return;
    if (stored?.roomCode === normalized) return;
    let disposed = false;
    const enterSpectatorIfAvailable = async () => {
      try {
        const info = await api.roomInfo(normalized);
        if (info.joinRole !== "spectator") throw new Error("not spectator");
        const joined = await api.joinRoom(normalized, {});
        if (disposed) return;
        const next: StoredMultiRoom = {
          roomId: joined.roomId,
          roomCode: normalized,
          guestToken: joined.guestToken,
          role: joined.viewer.role,
          memberId: joined.viewer.memberId,
        };
        saveMultiRoom(next);
        setStored(next);
      } catch {
        clearMultiRoom();
        setRedirecting(true);
        router.replace("/multi");
      }
    };
    if (!stored) {
      void enterSpectatorIfAvailable();
      return () => {
        disposed = true;
      };
    }
    if (stored.roomCode !== normalized) {
      clearMultiRoom();
      setRedirecting(true);
      router.replace("/multi");
    }
    return () => {
      disposed = true;
    };
  }, [stored, normalized, router]);

  const {
    state,
    mySlot,
    memberId,
    role,
    actions,
    guessError,
    roomUnavailable,
  } = useRoom(stored?.roomId ?? "", stored?.guestToken ?? "");

  useEffect(() => {
    if (!stored || !state.viewer) return;
    if (
      stored.memberId === state.viewer.memberId &&
      stored.role === state.viewer.role
    )
      return;
    const next = {
      ...stored,
      memberId: state.viewer.memberId,
      role: state.viewer.role,
    };
    saveMultiRoom(next);
    setStored(next);
  }, [stored, state.viewer]);

  useEffect(() => {
    if (!stored?.memberSlot || !state.viewer?.memberId || !state.match) return;
    void migrateLegacyMultiplayerDraft(
      stored.roomId,
      state.match.matchIndex,
      stored.memberSlot,
      state.viewer.memberId,
    );
  }, [stored, state.viewer?.memberId, state.match]);

  useEffect(() => {
    if (state.room?.status === "closed") {
      clearMultiRoom();
      router.replace("/multi");
    }
  }, [state.room?.status, router]);

  useEffect(() => {
    if (!roomUnavailable) return;
    clearMultiRoom();
    router.replace("/multi");
  }, [roomUnavailable, router]);

  const status = state.room?.status ?? "connecting";
  const format = state.room?.format ?? "bo3";
  const mode = state.room?.mode ?? "race";
  const turnSeconds = state.room?.turnSeconds ?? 60;
  const visibleFields = visibleQuestionFields(
    state.questionScope?.rules,
    CHARACTER_GUESS_FIELDS,
  );
  const hasOpponent = state.members.length >= 2;
  const roleBeforeFirstSnapshot = state.room ? null : (stored?.role ?? null);
  const effectiveRole = role ?? roleBeforeFirstSnapshot;
  const isSpectator = effectiveRole === "spectator";
  const viewerMatchStatus = state.match?.scores.find(
    (score) => score.memberId === memberId,
  )?.status;
  const isEliminatedPlayer =
    effectiveRole === "player" && viewerMatchStatus === "eliminated";
  const playerSeat = mySlot ?? 1;
  const relaySlot: 1 | 2 = mySlot === 2 ? 2 : 1;
  const roundResultKey = state.roundResult
    ? `${state.roundResult.matchIndex}:${state.roundResult.roundIndex}`
    : null;
  const roundResultDismissed =
    roundResultKey !== null && dismissedRoundResultKey === roundResultKey;
  const showRoundResult = Boolean(state.roundResult && !roundResultDismissed);
  const showingFinalRoundResult = Boolean(
    status === "finished" &&
    state.matchResult &&
    state.roundResult &&
    !roundResultDismissed,
  );

  useEffect(() => {
    setForfeitConfirm(false);
    setRoundActionBusy(null);
  }, [state.match?.matchIndex, state.match?.roundIndex, state.round?.status]);

  useEffect(() => {
    setSelectedArchiveKey(null);
  }, [state.match?.matchIndex]);

  useEffect(() => {
    if (!forfeitConfirm) return;
    const timeoutId = window.setTimeout(() => setForfeitConfirm(false), 4000);
    return () => window.clearTimeout(timeoutId);
  }, [forfeitConfirm]);

  const handleLeave = async () => {
    await actions.leave();
    clearMultiRoom();
    router.replace("/multi");
  };

  const handleForfeitRound = async () => {
    if (!state.match || state.round?.status !== "playing") return;
    if (!forfeitConfirm) {
      setForfeitConfirm(true);
      return;
    }
    setRoundActionBusy("forfeit");
    setForfeitConfirm(false);
    try {
      await actions.forfeitRound();
    } finally {
      setRoundActionBusy(null);
    }
  };

  const handlePassRelayTurn = async () => {
    if (mode !== "relay" || !state.match || state.round?.status !== "playing")
      return;
    setRoundActionBusy("pass");
    try {
      await actions.passRelayTurn();
    } finally {
      setRoundActionBusy(null);
    }
  };

  const runRoomMutation = async (mutation: () => Promise<unknown>) => {
    try {
      await mutation();
    } catch (error) {
      try {
        await actions.refresh();
      } catch {
        // 保留原命令错误码供大厅显示；快照失败由现有连接恢复处理。
      }
      throw error;
    }
    await actions.refresh();
  };

  if (stored === undefined || redirecting) return null;

  if (state.room && !state.viewer) {
    return (
      <>
        <section className="px-[18px] pt-16 text-center text-ink-soft">
          身份同步中……
        </section>
        <ConnectionNotice message={state.connectionIssue} />
      </>
    );
  }

  if (isSpectator && !state.room) {
    return (
      <>
        <section className="px-[18px] pt-16 text-center text-ink-soft">
          观战席同步中……
        </section>
        <ConnectionNotice
          message={state.connectionIssue}
          onReconnect={actions.reconnect}
        />
      </>
    );
  }

  if (isSpectator && state.room && state.room.status === "lobby") {
    return (
      <>
        <RoomLobby
          roomCode={normalized}
          format={format}
          mode={mode}
          turnSeconds={turnSeconds}
          members={state.members}
          mySlot={1}
          playerLimit={state.room.playerLimit}
          playerCount={state.room.playerCount}
          availableSeats={state.room.availableSeats}
          spectatorCount={state.room.spectatorCount}
          isHost={false}
          viewerRole="spectator"
          viewerMemberId={memberId}
          onReady={actions.setReady}
          onClaimSeat={async () => {
            if (!stored?.roomId || !stored.guestToken) return;
            await runRoomMutation(() =>
              api.claimSeat(stored.roomId, stored.guestToken),
            );
          }}
          onLeave={handleLeave}
        />
        <ConnectionNotice
          message={state.connectionIssue}
          onReconnect={actions.reconnect}
        />
        <GuessErrorToast message={guessError} />
      </>
    );
  }

  if (isSpectator && state.room) {
    return (
      <>
        <SpectatorRoom
          state={state}
          format={format}
          mode={mode}
          fields={visibleFields}
          selectedArchiveKey={selectedArchiveKey}
          onSelectArchive={setSelectedArchiveKey}
          onLeave={handleLeave}
        />
        <ConnectionNotice
          message={state.connectionIssue}
          onReconnect={actions.reconnect}
        />
        <GuessErrorToast message={guessError} />
      </>
    );
  }

  if (isEliminatedPlayer && state.room?.status === "playing") {
    return (
      <>
        <SpectatorRoom
          state={state}
          format={format}
          mode={mode}
          fields={visibleFields}
          selectedArchiveKey={selectedArchiveKey}
          onSelectArchive={setSelectedArchiveKey}
          onLeave={handleLeave}
          eliminated
        />
        <ConnectionNotice
          message={state.connectionIssue}
          onReconnect={actions.reconnect}
        />
        <GuessErrorToast message={guessError} />
      </>
    );
  }

  if (status === "lobby" || status === "connecting") {
    return (
      <>
        <RoomLobby
          roomCode={normalized}
          format={format}
          mode={mode}
          turnSeconds={turnSeconds}
          members={state.members}
          mySlot={playerSeat}
          playerLimit={state.room?.playerLimit ?? 2}
          playerCount={state.room?.playerCount ?? state.members.length}
          availableSeats={state.room?.availableSeats ?? 0}
          spectatorCount={state.room?.spectatorCount ?? 0}
          isHost={state.viewer?.seat === 1}
          viewerRole={effectiveRole ?? "player"}
          viewerMemberId={memberId}
          onReady={actions.setReady}
          onApplyLimit={async (limit) => {
            if (!stored?.roomId || !stored.guestToken) return;
            await runRoomMutation(() =>
              api.updateRoomSettings(stored.roomId, stored.guestToken, limit),
            );
          }}
          onClaimSeat={async () => {
            if (!stored?.roomId || !stored.guestToken) return;
            await runRoomMutation(() =>
              api.claimSeat(stored.roomId, stored.guestToken),
            );
          }}
          onLeave={handleLeave}
        />
        <ConnectionNotice
          message={state.connectionIssue}
          onReconnect={actions.reconnect}
        />
        <GuessErrorToast message={guessError} />
      </>
    );
  }

  if ((status === "playing" || showingFinalRoundResult) && state.match) {
    const selectedPlayerArchive =
      state.roundArchives.find(
        (archive) =>
          `${archive.matchIndex}:${archive.roundIndex}` === selectedArchiveKey,
      ) ?? null;
    const inCountdown = state.round?.status === "countdown";
    const relayCanGuess =
      mode === "relay" &&
      state.round?.status === "playing" &&
      state.round.turnSeat === relaySlot &&
      hasOpponent;
    const relayRows = state.round?.shared?.rows ?? [];
    const relayMaxSkips = state.round?.maxSkipsPerPlayer ?? 2;
    const relaySkipsRemaining = relaySkipRemaining(
      relayRows,
      relaySlot,
      relayMaxSkips,
    );
    const relayCanPass = relayCanGuess && relaySkipsRemaining > 0;
    const participationStatus = state.round?.self.participationStatus;
    const participationMessage =
      roundActionBusy === "forfeit"
        ? "正在放弃本局……"
        : participationStatus === "forfeited"
          ? "你已放弃本局"
          : participationStatus === "correct"
            ? "你已猜中本局"
            : participationStatus === "exhausted"
              ? "本局猜测次数已用尽"
              : participationStatus === "timed_out"
                ? "本局已超时"
                : null;
    const raceReadOnly = mode === "race" && Boolean(participationMessage);
    const roundActions =
      state.round?.status === "playing" && !raceReadOnly ? (
        <RoundActionButtons
          mode={mode}
          forfeitConfirm={forfeitConfirm}
          actionBusy={roundActionBusy}
          relayCanPass={relayCanPass}
          relaySkipsRemaining={relaySkipsRemaining}
          relayMaxSkips={relayMaxSkips}
          onForfeit={handleForfeitRound}
          onPass={handlePassRelayTurn}
        />
      ) : null;
    const guessedIds =
      mode === "relay"
        ? new Set(
            state.round?.shared?.rows
              .filter((row) => row.kind === "guess" && row.guess)
              .map((row) => row.guess!.guessId) ?? [],
          )
        : new Set(state.round?.self.guesses.map((g) => g.guessId) ?? []);
    return (
      <>
        <RoundHistoryBar
          archives={state.roundArchives.filter(
            (archive) => archive.matchIndex === state.match?.matchIndex,
          )}
          viewerMemberId={memberId}
          selectedKey={selectedArchiveKey}
          onSelect={setSelectedArchiveKey}
        />
        {mode === "relay" ? (
          <RelayMatchBoard
            format={format}
            match={state.match}
            round={state.round}
            members={state.members}
            mySlot={relaySlot}
            roundResult={selectedPlayerArchive ?? state.roundResult}
            roundActions={selectedPlayerArchive ? null : roundActions}
            fields={visibleFields}
          />
        ) : (
          <MatchBoard
            format={format}
            match={state.match}
            round={state.round}
            memberId={memberId}
            members={state.members}
            roundResult={selectedPlayerArchive ?? state.roundResult}
            catalogVersion={state.catalogVersion ?? undefined}
            onGuess={actions.submitGuess}
            disabled={!hasOpponent}
            roundActions={selectedPlayerArchive ? null : roundActions}
            fields={visibleFields}
          />
        )}
        {state.round?.status === "playing" && !selectedPlayerArchive && (
          <GuessInputBar
            onGuess={actions.submitGuess}
            disabled={
              mode === "relay" ? !relayCanGuess : !hasOpponent || raceReadOnly
            }
            catalogVersion={state.catalogVersion ?? undefined}
            guessedIds={guessedIds}
            statusMessage={mode === "race" ? participationMessage : null}
          />
        )}
        {inCountdown &&
          state.round &&
          !state.roundResult &&
          !selectedPlayerArchive && (
            <CountdownOverlay startsAt={state.round.startsAt} />
          )}
        {showRoundResult && state.roundResult && (
          <RoundResultOverlay
            result={state.roundResult}
            memberId={memberId}
            members={state.members}
            nextRoundStartsAt={state.roundResult.nextStartsAt ?? null}
            autoDismissAtCountdownEnd={Boolean(state.matchResult)}
            onDismiss={() => {
              if (roundResultKey) setDismissedRoundResultKey(roundResultKey);
            }}
          />
        )}
        <ConnectionNotice
          message={state.connectionIssue}
          onReconnect={actions.reconnect}
        />
        <GuessErrorToast message={guessError} />
      </>
    );
  }

  if (
    status === "finished" &&
    state.matchResult &&
    showRoundResult &&
    state.roundResult
  ) {
    return (
      <>
        <RoundResultOverlay
          result={state.roundResult}
          memberId={memberId}
          members={state.members}
          nextRoundStartsAt={state.roundResult.nextStartsAt ?? null}
          autoDismissAtCountdownEnd
          onDismiss={() => {
            if (roundResultKey) setDismissedRoundResultKey(roundResultKey);
          }}
        />
        <ConnectionNotice
          message={state.connectionIssue}
          onReconnect={actions.reconnect}
        />
        <GuessErrorToast message={guessError} />
      </>
    );
  }

  if (status === "finished" && state.matchResult) {
    return (
      <>
        <MatchResultOverlay
          result={state.matchResult}
          memberId={memberId}
          members={state.members}
          format={format}
          rematchReady={state.rematchReady}
          onRematch={actions.rematch}
          onLeave={handleLeave}
        />
        <ConnectionNotice
          message={state.connectionIssue}
          onReconnect={actions.reconnect}
        />
        <GuessErrorToast message={guessError} />
      </>
    );
  }

  return (
    <section className="px-[18px] pt-16 text-center text-ink-soft">
      房间状态同步中……
    </section>
  );
}

function ConnectionNotice({
  message,
  onReconnect,
}: {
  message: string | null;
  onReconnect?: () => void;
}) {
  if (!message) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center px-4">
      <div
        className="pointer-events-auto flex items-center gap-2 rounded-[6px] border border-amber-soft bg-paper px-4 py-2 text-[0.78rem] font-semibold text-ink-soft shadow-sm"
        role="status"
      >
        <span>{message}</span>
        {message.startsWith("其他页面已连接") && onReconnect ? (
          <button
            type="button"
            onClick={onReconnect}
            className="rounded border border-line px-2 py-1 font-bold"
          >
            重新连接
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SpectatorRoom({
  state,
  format,
  mode,
  fields,
  selectedArchiveKey,
  onSelectArchive,
  onLeave,
  eliminated = false,
}: {
  state: RoomUiState;
  format: string;
  mode: string;
  fields: readonly GuessField[];
  selectedArchiveKey: string | null;
  onSelectArchive: (key: string | null) => void;
  onLeave: () => void;
  eliminated?: boolean;
}) {
  const selectedArchive =
    state.roundArchives.find(
      (archive) =>
        `${archive.matchIndex}:${archive.roundIndex}` === selectedArchiveKey,
    ) ?? null;
  const latestArchive = state.roundArchives.at(-1) ?? null;
  const displayArchive =
    selectedArchive ??
    (state.room?.status === "finished" ||
    state.round?.status === "ended" ||
    !state.round
      ? latestArchive
      : null);
  const retentionUntil =
    state.matchResult?.retentionEndsAt ?? state.room?.expiresAt ?? null;
  const remaining = useRoomClock(
    state.room?.status === "finished" ? retentionUntil : null,
  );
  const waitingToStart = state.room?.status === "lobby" && !state.match;
  const preparingNextRound = Boolean(
    !state.matchResult &&
    state.roundResult &&
    state.round?.status !== "playing",
  );
  const winnerName = state.matchResult?.winnerMemberId
    ? (state.members.find(
        (member) => member.memberId === state.matchResult?.winnerMemberId,
      )?.displayName ?? null)
    : null;

  return (
    <section className="px-[18px] pt-5 pb-16">
      <div className="mx-auto max-w-[1280px]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-line bg-paper px-4 py-2.5 shadow-sm">
          <span className="rounded bg-jade-soft px-2 py-0.5 text-[0.72rem] font-black text-jade">
            {eliminated ? "已淘汰 · 观战" : "观战席"} ·{" "}
            {MULTIPLAYER_MODE_LABELS[
              mode as keyof typeof MULTIPLAYER_MODE_LABELS
            ] ?? mode}{" "}
            ·{" "}
            {ROOM_FORMAT_SHORT[format as keyof typeof ROOM_FORMAT_SHORT] ??
              format}
          </span>
          {waitingToStart ? (
            <span className="rounded bg-vermilion-soft px-2 py-0.5 text-[0.82rem] font-black text-vermilion">
              等待开始
            </span>
          ) : (
            <MemberScoreStrip
              members={state.members}
              scores={state.match?.scores ?? []}
              viewerMemberId={state.viewer?.memberId}
              winnerMemberId={state.matchResult?.winnerMemberId}
            />
          )}
          <span className="text-[0.75rem] text-ink-soft">
            观战 {state.room?.spectatorCount ?? 0}
          </span>
          <button
            type="button"
            onClick={onLeave}
            className="rounded-[6px] border border-line-strong bg-paper-muted px-3 py-1.5 text-[0.75rem] font-bold text-ink-soft hover:bg-paper"
          >
            退出房间
          </button>
        </div>

        {state.matchResult ? (
          <div className="mb-3 rounded-[6px] border border-jade bg-jade-soft px-4 py-3 text-[0.86rem] font-bold text-jade">
            {winnerName ? `${winnerName} 赢得本场对局` : "本场对局平局"}
            {state.room?.status === "finished" ? (
              <span className="ml-2 text-ink-soft tabular-nums">
                房间保留 {formatRemaining(remaining)}
              </span>
            ) : null}
          </div>
        ) : preparingNextRound ? (
          <div className="relay-current-turn-active mb-3 rounded-[6px] border border-vermilion bg-paper px-4 py-3 text-[0.86rem] font-black text-vermilion">
            即将进行下一局…
          </div>
        ) : null}

        <SpectatorArchiveBar
          archives={state.roundArchives}
          selectedKey={
            displayArchive
              ? `${displayArchive.matchIndex}:${displayArchive.roundIndex}`
              : null
          }
          showCurrent={!state.matchResult && state.room?.status !== "finished"}
          onSelect={onSelectArchive}
        />

        {mode === "relay" ? (
          <RelayMatchBoard
            format={format}
            match={state.match}
            round={state.round}
            members={state.members}
            mySlot={1}
            viewerRole="spectator"
            roundResult={displayArchive}
            fields={fields}
          />
        ) : (
          <SpectatorRaceBoards
            boards={displayArchive?.boards ?? state.round?.boards ?? []}
            members={state.members}
            fields={fields}
            archive={displayArchive}
          />
        )}
      </div>
    </section>
  );
}

function SpectatorArchiveBar({
  archives,
  selectedKey,
  showCurrent = true,
  onSelect,
}: {
  archives: RoundEndedPayload[];
  selectedKey: string | null;
  showCurrent?: boolean;
  onSelect: (key: string | null) => void;
}) {
  if (archives.length === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {showCurrent ? (
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`rounded px-2 py-1 text-[0.7rem] font-bold ${selectedKey === null ? "bg-jade-soft text-jade" : "bg-paper-muted text-ink-soft"}`}
        >
          当前棋盘
        </button>
      ) : null}
      {archives.map((archive) => {
        const key = `${archive.matchIndex}:${archive.roundIndex}`;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(key)}
            className={`rounded px-2 py-1 text-[0.7rem] font-bold ${selectedKey === key ? "bg-jade-soft text-jade" : "bg-paper-muted text-ink-soft"}`}
          >
            第 {archive.matchIndex + 1} 场 · 第 {archive.roundIndex} 局
          </button>
        );
      })}
    </div>
  );
}

function SpectatorRaceBoards({
  boards,
  members,
  fields,
  archive,
}: {
  boards: SpectatorBoards;
  members: components["schemas"]["MemberView"][];
  fields: readonly GuessField[];
  archive: RoundEndedPayload | null;
}) {
  const forfeitedMemberId = archive?.forfeitedMemberId;
  const ordered = [...boards].sort((a, b) => a.seat - b.seat);
  const toRows = (memberId: string): GuessRow[] => {
    const board =
      boards.find((entry) => entry.memberId === memberId)?.guesses ?? [];
    const rows: GuessRow[] = board.map((guess, index) => ({
      key: `${memberId}:${guess.guessId}:${index}`,
      name: guess.guessName,
      avatarUrl: guess.guessAvatarUrl,
      isCorrect: guess.isCorrect,
      cells: guess.feedback.map((field) => ({
        status: field.status,
        value: field.displayValue.join("、"),
      })),
    }));
    if (archive && forfeitedMemberId === memberId) {
      rows.push({
        key: `${memberId}:forfeit:${archive.matchIndex}:${archive.roundIndex}`,
        notice: "玩家放弃此局",
        tone: "danger",
      });
    }
    return rows;
  };
  const winnerBadge = (
    <span className="rounded bg-jade-soft px-2 py-0.5 text-[0.68rem] font-black text-jade">
      胜利
    </span>
  );
  const winnerMemberId = archive?.winnerMemberId;
  return (
    <MemberPaginator
      items={ordered}
      label="玩家棋盘"
      renderItem={(board) => (
        <GuessTable
          key={board.memberId}
          title={
            members.find((member) => member.memberId === board.memberId)
              ?.displayName ?? `玩家 ${board.seat}`
          }
          subtitle={archive ? `第 ${archive.roundIndex} 局记录` : "实时棋盘"}
          headerExtra={winnerMemberId === board.memberId ? winnerBadge : null}
          rows={toRows(board.memberId)}
          emptyLabel="该玩家暂无猜测。"
          fields={fields}
          highlight={winnerMemberId === board.memberId}
        />
      )}
    />
  );
}

function RoundActionButtons({
  mode,
  forfeitConfirm,
  actionBusy,
  relayCanPass,
  relaySkipsRemaining,
  relayMaxSkips,
  onForfeit,
  onPass,
}: {
  mode: string;
  forfeitConfirm: boolean;
  actionBusy: "forfeit" | "pass" | null;
  relayCanPass: boolean;
  relaySkipsRemaining: number;
  relayMaxSkips: number;
  onForfeit: () => void;
  onPass: () => void;
}) {
  const forfeitLabel =
    actionBusy === "forfeit"
      ? "提交中……"
      : forfeitConfirm
        ? "再次点击确认放弃"
        : "放弃本局";
  const passDisabled = actionBusy !== null || !relayCanPass;
  const passTitle =
    relaySkipsRemaining <= 0 ? "本局空过次数已用完" : "主动空过本轮猜测";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {mode === "relay" ? (
        <button
          type="button"
          onClick={onPass}
          disabled={passDisabled}
          title={passTitle}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-[6px] border border-line-strong bg-paper-muted px-3 py-1.5 text-[0.75rem] font-bold text-ink-soft hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FastForward size={14} aria-hidden="true" />
          本轮空过
          <span className="rounded bg-paper px-1.5 py-0.5 text-[0.68rem] tabular-nums">
            余 {relaySkipsRemaining}/{relayMaxSkips}
          </span>
        </button>
      ) : null}
      <button
        type="button"
        onClick={onForfeit}
        disabled={actionBusy !== null}
        title={forfeitConfirm ? "再次点击确认放弃本局" : "放弃本局"}
        className={`inline-flex min-h-8 items-center gap-1.5 rounded-[6px] border px-3 py-1.5 text-[0.75rem] font-bold disabled:cursor-not-allowed disabled:opacity-50 ${
          forfeitConfirm
            ? "border-vermilion bg-vermilion-soft text-vermilion"
            : "border-line-strong bg-paper-muted text-ink-soft hover:bg-paper"
        }`}
      >
        <Flag size={14} aria-hidden="true" />
        {forfeitLabel}
      </button>
    </div>
  );
}

function RoundHistoryBar({
  archives,
  viewerMemberId,
  selectedKey,
  onSelect,
}: {
  archives: RoundEndedPayload[];
  viewerMemberId: string | null;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}) {
  return (
    <div className="px-[18px] pt-3 pb-1">
      <ul className="flex flex-wrap gap-1.5">
        <li>
          <button
            type="button"
            aria-pressed={selectedKey === null}
            onClick={() => onSelect(null)}
            className={`rounded border px-2 py-1 text-[0.7rem] font-bold ${selectedKey === null ? "border-vermilion bg-vermilion-soft text-vermilion" : "border-transparent bg-paper-muted text-ink-soft"}`}
          >
            返回当前局
          </button>
        </li>
        {archives.map((archive) => {
          const key = `${archive.matchIndex}:${archive.roundIndex}`;
          const result =
            archive.viewerResult ??
            resultForMemberId(archive.results, viewerMemberId) ??
            "draw";
          const placement = archive.placements?.find(
            (entry) => entry.memberId === viewerMemberId,
          );
          const selectedBorder =
            result === "win"
              ? "border-jade"
              : result === "loss"
                ? "border-vermilion"
                : "border-line-strong";
          return (
            <li key={key}>
              <button
                type="button"
                aria-pressed={selectedKey === key}
                onClick={() => onSelect(key)}
                className={`rounded border px-2 py-1 text-[0.7rem] font-bold ${selectedKey === key ? selectedBorder : "border-transparent"} ${
                  result === "win"
                    ? "bg-jade-soft text-jade"
                    : result === "loss"
                      ? "bg-vermilion-soft text-vermilion"
                      : "bg-paper-muted text-ink-soft"
                }`}
              >
                第 {archive.roundIndex} 局 ·{" "}
                {placement
                  ? `+${placement.pointsAwarded} 分${archive.eliminatedMemberIds?.includes(viewerMemberId ?? "") ? " · 已淘汰" : ""}`
                  : result === "win"
                    ? "胜"
                    : result === "loss"
                      ? "负"
                      : "平"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function GuessErrorToast({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="fixed inset-x-0 bottom-20 z-50 flex justify-center px-4">
      <p
        className="rounded-[6px] border border-vermilion-soft bg-vermilion-soft px-4 py-2 text-[0.8rem] font-semibold text-vermilion shadow-sm"
        role="alert"
      >
        {message}
      </p>
    </div>
  );
}
