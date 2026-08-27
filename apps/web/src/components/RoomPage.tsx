"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  clearMultiRoom,
  loadMultiRoom,
  normalizeRoomCode,
  saveMultiRoom,
} from "../domain/multiRoom";
import type { StoredMultiRoom } from "../domain/multiRoom";
import { useRoom } from "../hooks/useRoom";
import {
  isChatSendUiEnabled,
  isChatUiEnabled,
} from "../config/multiplayerRollout";
import { api } from "../lib/api";
import { MultiplayerBottomDockProvider } from "../multiplayer/framework";
import { matchExperienceFor } from "../multiplayer/modeExperienceRegistry";
import { migrateLegacyMultiplayerDraft } from "../stats/multiplayerRecorder";
import { ChatDock } from "./ChatDock";
import { RoomLobby } from "./RoomLobby";

export function RoomView({ code }: { code: string }) {
  const router = useRouter();
  const normalized = normalizeRoomCode(code);
  const [stored, setStored] = useState<StoredMultiRoom | null | undefined>(
    undefined,
  );
  const [redirecting, setRedirecting] = useState(false);

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
  const visibleFields = state.match?.activeFields ?? [];
  const roleBeforeFirstSnapshot = state.room ? null : (stored?.role ?? null);
  const effectiveRole = role ?? roleBeforeFirstSnapshot;
  const isSpectator = effectiveRole === "spectator";
  const playerSeat = mySlot ?? 1;
  const chatUiEnabled = isChatUiEnabled();
  const chatSendUiEnabled = isChatSendUiEnabled();
  const chatDock =
    chatUiEnabled &&
    state.room &&
    state.viewer &&
    stored?.roomId &&
    stored?.guestToken ? (
      <ChatDock
        roomId={stored.roomId}
        viewer={state.viewer}
        chat={state.chat}
        disabled={roomUnavailable}
        sendEnabled={chatSendUiEnabled}
        onSend={actions.sendChat}
        onRetry={actions.retryChat}
        onLoadOlder={actions.loadOlderChat}
        onClearError={actions.clearChatError}
      />
    ) : null;

  const handleLeave = async () => {
    await actions.leave();
    clearMultiRoom();
    router.replace("/multi");
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
      <MultiplayerBottomDockProvider persistentDock={chatDock}>
        <RoomLobby
          roomCode={normalized}
          format={format}
          mode={mode}
          turnSeconds={turnSeconds}
          members={state.members}
          mySlot={1}
          playerLimit={state.room.playerLimit}
          raceEliminationEnabled={state.room.raceEliminationEnabled}
          relayEliminationEnabled={state.room.relayEliminationEnabled}
          startBlockedReason={state.room.startBlockedReason}
          playerCount={state.room.playerCount}
          availableSeats={state.room.availableSeats}
          spectatorCount={state.room.spectatorCount}
          isHost={false}
          viewerRole="spectator"
          viewerMemberId={memberId}
          onReady={actions.setReady}
          onApplySettings={async (settings) => {
            if (!stored?.roomId || !stored.guestToken) return;
            await runRoomMutation(() =>
              api.updateRoomSettings(
                stored.roomId,
                stored.guestToken,
                settings,
              ),
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
      </MultiplayerBottomDockProvider>
    );
  }

  if (
    state.room &&
    state.match &&
    state.viewer &&
    stored?.roomId &&
    stored.guestToken &&
    (state.room.status === "playing" || state.room.status === "finished")
  ) {
    const MatchExperience = matchExperienceFor(mode);
    return (
      <MultiplayerBottomDockProvider persistentDock={chatDock}>
        <MatchExperience
          roomId={stored.roomId}
          token={stored.guestToken}
          state={state}
          format={format}
          fields={visibleFields}
          memberId={memberId}
          role={effectiveRole}
          actions={actions}
          onLeave={handleLeave}
        />
        <ConnectionNotice
          message={state.connectionIssue}
          onReconnect={actions.reconnect}
        />
        <GuessErrorToast message={guessError} />
      </MultiplayerBottomDockProvider>
    );
  }

  if (status === "lobby" || status === "connecting") {
    return (
      <MultiplayerBottomDockProvider persistentDock={chatDock}>
        <RoomLobby
          roomCode={normalized}
          format={format}
          mode={mode}
          turnSeconds={turnSeconds}
          members={state.members}
          mySlot={playerSeat}
          playerLimit={state.room?.playerLimit ?? 2}
          raceEliminationEnabled={state.room?.raceEliminationEnabled ?? false}
          relayEliminationEnabled={state.room?.relayEliminationEnabled}
          startBlockedReason={state.room?.startBlockedReason}
          playerCount={state.room?.playerCount ?? state.members.length}
          availableSeats={state.room?.availableSeats ?? 0}
          spectatorCount={state.room?.spectatorCount ?? 0}
          isHost={state.viewer?.seat === 1}
          viewerRole={effectiveRole ?? "player"}
          viewerMemberId={memberId}
          onReady={actions.setReady}
          onApplySettings={async (settings) => {
            if (!stored?.roomId || !stored.guestToken) return;
            await runRoomMutation(() =>
              api.updateRoomSettings(
                stored.roomId,
                stored.guestToken,
                settings,
              ),
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
      </MultiplayerBottomDockProvider>
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
