"use client";

// 房间页编排（08 §10.2/§10.3）：useRoom 连接 + 视图切换
// （lobby → 对局 → 结果；断线重连/缺口补齐由 useRoom 处理）。
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  clearMultiRoom,
  loadMultiRoom,
  normalizeRoomCode,
} from "../domain/multiRoom";
import type { StoredMultiRoom } from "../domain/multiRoom";
import { useRoom } from "../hooks/useRoom";
import { CountdownOverlay } from "./CountdownOverlay";
import { GuessInputBar } from "./GuessInputBar";
import { MatchBoard } from "./MatchBoard";
import { MatchResultOverlay } from "./MatchResultOverlay";
import { RoomLobby } from "./RoomLobby";
import { RoundResultOverlay } from "./RoundResultOverlay";

export function RoomView({ code }: { code: string }) {
  const router = useRouter();
  const normalized = normalizeRoomCode(code);
  // 加载放在 effect：避免 SSR 访问 window.localStorage（hydration 失败）
  const [stored, setStored] = useState<StoredMultiRoom | null | undefined>(undefined);
  const [redirecting, setRedirecting] = useState(false);

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
  const hasOpponent = state.members.length === 2;

  const handleLeave = async () => {
    await actions.leave();
    clearMultiRoom();
    router.replace("/multi");
  };

  if (stored === undefined || redirecting) return null;

  // 大厅态
  if (status === "lobby" || status === "connecting") {
    return (
      <>
        <RoomLobby
          roomCode={normalized}
          format={format}
          members={state.members}
          mySlot={mySlot}
          onReady={actions.setReady}
          onLeave={handleLeave}
        />
        <GuessErrorToast message={guessError} />
      </>
    );
  }

  // 对局态
  if (status === "playing" && state.match) {
    const inCountdown = state.round?.status === "countdown";
    return (
      <>
        <MatchBoard
          format={format}
          match={state.match}
          round={state.round}
          mySlot={mySlot}
          roundResult={state.roundResult}
          catalogVersion={state.catalogVersion ?? undefined}
          onGuess={actions.submitGuess}
          disabled={!hasOpponent}
        />
        <RoundHistoryBar history={state.history} />
        {state.round?.status === "playing" && (
          <GuessInputBar
            onGuess={actions.submitGuess}
            disabled={!hasOpponent}
            catalogVersion={state.catalogVersion ?? undefined}
            guessedIds={
              new Set(state.round?.self.guesses.map((g) => g.guessId) ?? [])
            }
          />
        )}
        {inCountdown && state.round && !state.roundResult && (
          <CountdownOverlay startsAt={state.round.startsAt} />
        )}
        {state.roundResult && (
          <RoundResultOverlay
            result={state.roundResult}
            mySlot={mySlot}
            nextRoundStartsAt={state.roundResult.nextStartsAt ?? null}
          />
        )}
        <GuessErrorToast message={guessError} />
      </>
    );
  }

  // 对局结束（等待再来一局 / 结果展示）
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
