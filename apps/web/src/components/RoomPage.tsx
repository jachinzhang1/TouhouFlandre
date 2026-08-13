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
  boardAtSeat,
  scoreAtSeat,
  seatForMemberId,
} from "../domain/memberCollections";
import { useRoom, type RoomUiState } from "../hooks/useRoom";
import { useRoomClock, formatRemaining } from "../hooks/useRoomClock";
import { api } from "../lib/api";
import { CountdownOverlay } from "./CountdownOverlay";
import { GuessInputBar } from "./GuessInputBar";
import { GuessTable, type GuessRow } from "./GuessTable";
import { MatchBoard } from "./MatchBoard";
import { MatchResultOverlay } from "./MatchResultOverlay";
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
          memberSlot: undefined,
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

  const { state, mySlot, role, actions, guessError, roomUnavailable } = useRoom(
    stored?.roomId ?? "",
    stored?.guestToken ?? "",
    stored?.role === "spectator" ? null : (stored?.memberSlot ?? 1),
    stored?.role ?? "player",
  );

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
  const hasOpponent = state.members.length === 2;
  const isSpectator = role === "spectator" || mySlot === null;
  const playerSlot: 1 | 2 = mySlot ?? 1;
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

  if (stored === undefined || redirecting) return null;

  if (isSpectator && !state.room) {
    return (
      <>
        <section className="px-[18px] pt-16 text-center text-ink-soft">
          观战席同步中……
        </section>
        <ConnectionNotice message={state.connectionIssue} />
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
        <ConnectionNotice message={state.connectionIssue} />
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
          mySlot={playerSlot}
          onReady={actions.setReady}
          onLeave={handleLeave}
        />
        <ConnectionNotice message={state.connectionIssue} />
        <GuessErrorToast message={guessError} />
      </>
    );
  }

  if ((status === "playing" || showingFinalRoundResult) && state.match) {
    const inCountdown = state.round?.status === "countdown";
    const relayCanGuess =
      mode === "relay" &&
      state.round?.status === "playing" &&
      state.round.turnSeat === playerSlot &&
      hasOpponent;
    const relayRows = state.round?.shared?.rows ?? [];
    const relayMaxSkips = state.round?.maxSkipsPerPlayer ?? 2;
    const relaySkipsRemaining = relaySkipRemaining(
      relayRows,
      playerSlot,
      relayMaxSkips,
    );
    const relayCanPass = relayCanGuess && relaySkipsRemaining > 0;
    const roundActions =
      state.round?.status === "playing" ? (
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
        {mode === "relay" ? (
          <RelayMatchBoard
            format={format}
            match={state.match}
            round={state.round}
            members={state.members}
            mySlot={playerSlot}
            roundResult={state.roundResult}
            roundActions={roundActions}
            fields={visibleFields}
          />
        ) : (
          <MatchBoard
            format={format}
            match={state.match}
            round={state.round}
            mySlot={playerSlot}
            roundResult={state.roundResult}
            catalogVersion={state.catalogVersion ?? undefined}
            onGuess={actions.submitGuess}
            disabled={!hasOpponent}
            roundActions={roundActions}
            fields={visibleFields}
          />
        )}
        <RoundHistoryBar history={state.history} />
        {state.round?.status === "playing" && (
          <GuessInputBar
            onGuess={actions.submitGuess}
            disabled={mode === "relay" ? !relayCanGuess : !hasOpponent}
            catalogVersion={state.catalogVersion ?? undefined}
            guessedIds={guessedIds}
          />
        )}
        {inCountdown && state.round && !state.roundResult && (
          <CountdownOverlay startsAt={state.round.startsAt} />
        )}
        {showRoundResult && state.roundResult && (
          <RoundResultOverlay
            result={state.roundResult}
            mySlot={playerSlot}
            nextRoundStartsAt={state.roundResult.nextStartsAt ?? null}
            autoDismissAtCountdownEnd={Boolean(state.matchResult)}
            onDismiss={() => {
              if (roundResultKey) setDismissedRoundResultKey(roundResultKey);
            }}
          />
        )}
        <ConnectionNotice message={state.connectionIssue} />
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
          mySlot={playerSlot}
          nextRoundStartsAt={state.roundResult.nextStartsAt ?? null}
          autoDismissAtCountdownEnd
          onDismiss={() => {
            if (roundResultKey) setDismissedRoundResultKey(roundResultKey);
          }}
        />
        <ConnectionNotice message={state.connectionIssue} />
        <GuessErrorToast message={guessError} />
      </>
    );
  }

  if (status === "finished" && state.matchResult) {
    return (
      <>
        <MatchResultOverlay
          result={state.matchResult}
          mySlot={playerSlot}
          format={format}
          rematchReady={state.rematchReady}
          onRematch={actions.rematch}
          onLeave={handleLeave}
        />
        <ConnectionNotice message={state.connectionIssue} />
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

function ConnectionNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center px-4">
      <p
        className="rounded-[6px] border border-amber-soft bg-paper px-4 py-2 text-[0.78rem] font-semibold text-ink-soft shadow-sm"
        role="status"
      >
        {message}
      </p>
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
}: {
  state: RoomUiState;
  format: string;
  mode: string;
  fields: readonly GuessField[];
  selectedArchiveKey: string | null;
  onSelectArchive: (key: string | null) => void;
  onLeave: () => void;
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
            观战席 ·{" "}
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
            <span className="text-[0.95rem] font-black tabular-nums">
              {scoreAtSeat(state.match?.scores, 1)} :{" "}
              {scoreAtSeat(state.match?.scores, 2)}
            </span>
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
  const forfeitedSeat = seatForMemberId(members, archive?.forfeitedMemberId);
  const toRows = (slot: 1 | 2): GuessRow[] => {
    const board = boardAtSeat(boards, slot);
    const rows: GuessRow[] = board.map((guess, index) => ({
      key: `${slot}:${guess.guessId}:${index}`,
      name: guess.guessName,
      avatarUrl: guess.guessAvatarUrl,
      isCorrect: guess.isCorrect,
      cells: guess.feedback.map((field) => ({
        status: field.status,
        value: field.displayValue.join("、"),
      })),
    }));
    if (archive && forfeitedSeat === slot) {
      rows.push({
        key: `${slot}:forfeit:${archive.matchIndex}:${archive.roundIndex}`,
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
  const winnerSeat = seatForMemberId(members, archive?.winnerMemberId);
  return (
    <div className="grid grid-cols-2 items-start gap-3 max-[1100px]:grid-cols-1">
      <GuessTable
        title={
          members.find((member) => member.seat === 1)?.displayName ?? "玩家 1"
        }
        subtitle={archive ? `第 ${archive.roundIndex} 局记录` : "实时棋盘"}
        headerExtra={winnerSeat === 1 ? winnerBadge : null}
        rows={toRows(1)}
        emptyLabel="该玩家暂无猜测。"
        fields={fields}
        highlight={winnerSeat === 1}
      />
      <GuessTable
        title={
          members.find((member) => member.seat === 2)?.displayName ?? "玩家 2"
        }
        subtitle={archive ? `第 ${archive.roundIndex} 局记录` : "实时棋盘"}
        headerExtra={winnerSeat === 2 ? winnerBadge : null}
        rows={toRows(2)}
        emptyLabel="该玩家暂无猜测。"
        fields={fields}
        highlight={winnerSeat === 2}
      />
    </div>
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
  history,
}: {
  history: { roundIndex: number; result: string }[];
}) {
  if (history.length === 0) return null;
  return (
    <div className="px-[18px] pb-2">
      <ul className="flex flex-wrap gap-1.5">
        {history.map((h) => (
          <li
            key={h.roundIndex}
            className={`rounded px-2 py-0.5 text-[0.7rem] font-bold ${
              h.result === "win"
                ? "bg-jade-soft text-jade"
                : h.result === "loss"
                  ? "bg-vermilion-soft text-vermilion"
                  : "bg-paper-muted text-ink-soft"
            }`}
          >
            第 {h.roundIndex} 局 ·{" "}
            {h.result === "win" ? "胜" : h.result === "loss" ? "负" : "平"}
          </li>
        ))}
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
