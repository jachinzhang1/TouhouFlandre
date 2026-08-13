"use client";

// 房间页编排（08 §10.2/§10.3）：useRoom 连接 + 视图切换
// （lobby → 对局 → 结果；断线重连/缺口补齐由 useRoom 处理）。
import { FastForward, Flag } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CHARACTER_GUESS_FIELDS,
  visibleQuestionFields,
} from "@touhouflandre/shared";
import {
  clearMultiRoom,
  loadMultiRoom,
  normalizeRoomCode,
  relaySkipRemaining,
} from "../../domain/multiRoom";
import type { StoredMultiRoom } from "../../domain/multiRoom";
import { useRoom } from "../../hooks/useRoom";
import { CountdownOverlay } from "./CountdownOverlay";
import { GuessInputBar } from "../game/GuessInputBar";
import { MatchBoard } from "./MatchBoard";
import { MatchResultOverlay } from "./MatchResultOverlay";
import { RelayMatchBoard } from "./RelayMatchBoard";
import { RoomLobby } from "./RoomLobby";
import { RoundResultOverlay } from "./RoundResultOverlay";

export function RoomView({ code }: { code: string }) {
  const router = useRouter();
  const normalized = normalizeRoomCode(code);
  // 加载放在 effect：避免 SSR 访问 window.localStorage（hydration 失败）
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

  useEffect(() => {
    setStored(loadMultiRoom());
  }, []);

  // 无成员资格/房间号不匹配 → 清理并重定向大厅（08 §10.1）
  useEffect(() => {
    if (stored === undefined) return; // storage 尚未加载
    if (!stored || stored.roomCode !== normalized) {
      clearMultiRoom();
      setRedirecting(true);
      router.replace("/multi");
    }
  }, [stored, normalized, router]);

  const { state, mySlot, actions, guessError, roomUnavailable } = useRoom(
    stored?.roomId ?? "",
    stored?.guestToken ?? "",
    stored?.memberSlot ?? 1,
  );

  // 房间关闭（终态）→ 清理并返回大厅
  useEffect(() => {
    if (state.room?.status === "closed") {
      clearMultiRoom();
      router.replace("/multi");
    }
  }, [state.room?.status, router]);

  // 房间已超过保留期：草稿由 useRoom 标记为同步不完整，再清理恢复凭据。
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

  // 大厅态
  if (status === "lobby" || status === "connecting") {
    return (
      <>
        <RoomLobby
          roomCode={normalized}
          format={format}
          mode={mode}
          turnSeconds={turnSeconds}
          members={state.members}
          mySlot={mySlot}
          onReady={actions.setReady}
          onLeave={handleLeave}
        />
        <ConnectionNotice message={state.connectionIssue} />
        <GuessErrorToast message={guessError} />
      </>
    );
  }

  // 对局态
  if ((status === "playing" || showingFinalRoundResult) && state.match) {
    const inCountdown = state.round?.status === "countdown";
    const relayCanGuess =
      mode === "relay" &&
      state.round?.status === "playing" &&
      state.round.turnSlot === mySlot &&
      hasOpponent;
    const relayRows = state.round?.shared?.rows ?? [];
    const relayMaxSkips = state.round?.maxSkipsPerPlayer ?? 2;
    const relaySkipsRemaining = relaySkipRemaining(
      relayRows,
      mySlot,
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
            mySlot={mySlot}
            roundResult={state.roundResult}
            roundActions={roundActions}
            fields={visibleFields}
          />
        ) : (
          <MatchBoard
            format={format}
            match={state.match}
            round={state.round}
            mySlot={mySlot}
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
            mySlot={mySlot}
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

  // 对局结束（等待再来一局 / 结果展示）
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
          mySlot={mySlot}
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
          mySlot={mySlot}
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
