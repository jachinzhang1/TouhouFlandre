"use client";

import { FastForward, Flag } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  CHARACTER_GUESS_FIELDS,
  visibleQuestionFields,
  type GuessField,
  type RoundEndedPayload,
} from "@touhouflandre/shared";
import type { components } from "../../generated/api";
import {
  clearMultiRoom,
  loadMultiRoom,
  MULTIPLAYER_MODE_LABELS,
  normalizeRoomCode,
  relaySkipRemaining,
  ROOM_FORMAT_SHORT,
  saveMultiRoom,
} from "../../domain/multiRoom";
import type { StoredMultiRoom } from "../../domain/multiRoom";
import {
  isActiveMatchMember,
  isRoundArchiveParticipant,
  resultForMemberId,
  seatForMemberId,
} from "../../domain/memberCollections";
import {
  useRoom,
  type RoomActions,
  type RoomUiState,
} from "../../hooks/useRoom";
import { useRoomClock, formatRemaining } from "../../hooks/useRoomClock";
import {
  isChatSendUiEnabled,
  isChatUiEnabled,
} from "../../config/multiplayerRollout";
import { api } from "../../lib/api";
import { migrateLegacyMultiplayerDraft } from "../../stats/multiplayerRecorder";
import { CountdownOverlay } from "./CountdownOverlay";
import { GuessInputBar } from "../game/GuessInputBar";
import { GuessTable, type GuessRow } from "../game/GuessTable";
import { MatchBoard } from "./MatchBoard";
import { MatchResultOverlay } from "./MatchResultOverlay";
import { MemberPaginator } from "./MemberPaginator";
import { MemberScoreStrip } from "./MemberScoreStrip";
import { boardResultBadges, formatBoardTitle } from "./boardMeta";
import { ChatDock } from "./ChatDock";
import { RelayMatchBoard } from "./RelayMatchBoard";
import { RoomLobby } from "./RoomLobby";
import { RoundResultOverlay } from "./RoundResultOverlay";
import {
  buildMultiplayerGameSeed,
  clearMultiplayerGameSeed,
  installGameSeedConsole,
  loadMultiplayerGameSeed,
  MULTIPLAYER_GAME_SEED_PRESETS,
  parseMultiplayerGameSeedPreset,
  storeMultiplayerGameSeed,
  type MultiplayerGameSeed,
} from "../../dev/gameSeeds";
import {
  Paper,
  PaperButton,
  PaperSegmentButton,
  PaperSegmentGroup,
} from "@/components/paper";

const DEVELOPMENT_ROOM_ACTIONS: RoomActions = {
  reconnect: () => undefined,
  refresh: async () => undefined,
  sendChat: async () => false,
  retryChat: async () => undefined,
  loadOlderChat: async () => undefined,
  clearChatError: () => undefined,
  setReady: async () => undefined,
  leave: async () => undefined,
  rematch: async () => undefined,
  submitGuess: async () => undefined,
  forfeitRound: async () => undefined,
  passRelayTurn: async () => undefined,
};

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
  // 加载放在 effect：避免 SSR 访问 window.localStorage（hydration 失败）
  const [stored, setStored] = useState<StoredMultiRoom | null | undefined>(
    undefined,
  );
  const [developmentSeed, setDevelopmentSeed] =
    useState<MultiplayerGameSeed | null>(null);
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

  const applyDevelopmentSeed = useCallback(
    (preset: Parameters<typeof buildMultiplayerGameSeed>[0]) => {
      const seed = buildMultiplayerGameSeed(preset);
      setDevelopmentSeed(seed);
      void api
        .catalogFull()
        .then((catalog) => {
          setDevelopmentSeed((current) =>
            current
              ? {
                  ...current,
                  state: { ...current.state, catalogVersion: catalog.version },
                }
              : current,
          );
        })
        .catch(() => undefined);
      return seed;
    },
    [],
  );

  const resetDevelopmentSeed = useCallback(() => {
    clearMultiplayerGameSeed();
    setDevelopmentSeed(null);
    const liveStored = loadMultiRoom();
    if (liveStored?.roomCode === normalized) {
      setStored(liveStored);
      return;
    }
    setRedirecting(true);
    router.replace("/multi");
  }, [normalized, router]);

  useEffect(() => {
    const preset = loadMultiplayerGameSeed();
    if (preset) {
      const seed = applyDevelopmentSeed(preset);
      setStored({
        roomId: "development-room",
        roomCode: normalized,
        guestToken: "development-token",
        role: seed.role,
        memberId: seed.memberId,
      });
      return;
    }
    setStored(loadMultiRoom());
  }, [applyDevelopmentSeed, normalized]);

  useEffect(() => {
    if (stored === undefined) return;
    if (developmentSeed) return;
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
  }, [stored, normalized, router, developmentSeed]);

  const liveRoom = useRoom(
    developmentSeed ? "" : (stored?.roomId ?? ""),
    developmentSeed ? "" : (stored?.guestToken ?? ""),
  );
  const state = developmentSeed?.state ?? liveRoom.state;
  const mySlot = developmentSeed?.mySlot ?? liveRoom.mySlot;
  const memberId = developmentSeed?.memberId ?? liveRoom.memberId;
  const role = developmentSeed?.role ?? liveRoom.role;
  const actions = developmentSeed ? DEVELOPMENT_ROOM_ACTIONS : liveRoom.actions;
  const guessError = developmentSeed?.guessError ?? liveRoom.guessError;
  const roomUnavailable = developmentSeed ? false : liveRoom.roomUnavailable;
  useEffect(() => {
    return installGameSeedConsole({
      page: "multiplayer",
      presets: MULTIPLAYER_GAME_SEED_PRESETS,
      seed: (value) => {
        const preset = parseMultiplayerGameSeedPreset(value);
        storeMultiplayerGameSeed(preset);
        applyDevelopmentSeed(preset);
        setDismissedRoundResultKey(null);
        setSelectedArchiveKey(null);
        setForfeitConfirm(false);
        setRoundActionBusy(null);
        return preset;
      },
      reset: resetDevelopmentSeed,
    });
  }, [applyDevelopmentSeed, resetDevelopmentSeed]);

  useEffect(() => {
    if (developmentSeed || !stored || !state.viewer) return;
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
  }, [developmentSeed, stored, state.viewer]);

  useEffect(() => {
    if (
      developmentSeed ||
      !stored?.memberSlot ||
      !state.viewer?.memberId ||
      !state.match
    )
      return;
    void migrateLegacyMultiplayerDraft(
      stored.roomId,
      state.match.matchIndex,
      stored.memberSlot,
      state.viewer.memberId,
    );
  }, [developmentSeed, stored, state.viewer?.memberId, state.match]);

  useEffect(() => {
    if (developmentSeed) return;
    if (state.room?.status === "closed") {
      clearMultiRoom();
      router.replace("/multi");
    }
  }, [state.room?.status, router, developmentSeed]);

  useEffect(() => {
    if (!roomUnavailable || developmentSeed) return;
    clearMultiRoom();
    router.replace("/multi");
  }, [roomUnavailable, router, developmentSeed]);

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
  const chatUiEnabled = isChatUiEnabled();
  const chatSendUiEnabled = isChatSendUiEnabled();
  const renderChatDock = (placement: "inline" | "fixed" | "deck") =>
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
        placement={placement}
        sendEnabled={chatSendUiEnabled}
        onSend={actions.sendChat}
        onRetry={actions.retryChat}
        onLoadOlder={actions.loadOlderChat}
        onClearError={actions.clearChatError}
      />
    ) : null;

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
    if (developmentSeed) {
      resetDevelopmentSeed();
      return;
    }
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
        <div className="room-lobby-view">
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
          {renderChatDock("inline")}
        </div>
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
        {renderChatDock("fixed")}
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
        {renderChatDock("fixed")}
      </>
    );
  }

  if (status === "lobby" || status === "connecting") {
    return (
      <>
        <div className="room-lobby-view">
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
          {renderChatDock("inline")}
        </div>
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
    const showCommandDeck =
      state.round?.status === "playing" && !selectedPlayerArchive;
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
        {showCommandDeck ? (
          <div className="multiplayer-command-deck">
            <div className="multiplayer-command-deck-inner">
              {renderChatDock("deck")}
              <GuessInputBar
                onGuess={actions.submitGuess}
                disabled={
                  mode === "relay"
                    ? !relayCanGuess
                    : !hasOpponent || raceReadOnly
                }
                catalogVersion={state.catalogVersion ?? undefined}
                guessedIds={guessedIds}
                statusMessage={mode === "race" ? participationMessage : null}
              />
            </div>
          </div>
        ) : (
          renderChatDock("fixed")
        )}
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
        {renderChatDock("fixed")}
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
      <Paper
        animateOnMount={false}
        as="div"
        className="pointer-events-auto flex items-center gap-2 px-4 py-2 text-[0.78rem] font-semibold"
        elevation="sm"
        pattern={false}
        tone="warning"
        folded={false}
        role="status"
        sticker={false}
        unfoldOnHover={false}
      >
        <span>{message}</span>
        {message.startsWith("其他页面已连接") && onReconnect ? (
          <PaperButton compact folded={false} onClick={onReconnect}>
            重新连接
          </PaperButton>
        ) : null}
      </Paper>
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
        <Paper
          animateOnMount={false}
          as="div"
          className="mb-3 flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
          elevation="sm"
          pattern={false}
          folded={false}
          sticker={false}
          unfoldOnHover={false}
        >
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
          <PaperButton compact folded={false} onClick={onLeave}>
            退出房间
          </PaperButton>
        </Paper>

        {state.matchResult ? (
          <Paper
            animateOnMount={false}
            as="div"
            className="mb-3 px-4 py-3 text-[0.86rem] font-bold"
            folded={false}
            pattern={false}
            sticker={false}
            tone="success"
            unfoldOnHover={false}
            variant="tinted"
          >
            {winnerName ? `${winnerName} 赢得本场对局` : "本场对局平局"}
            {state.room?.status === "finished" ? (
              <span className="ml-2 tabular-nums">
                房间保留 {formatRemaining(remaining)}
              </span>
            ) : null}
          </Paper>
        ) : preparingNextRound ? (
          <Paper
            animateOnMount={false}
            as="div"
            className="mb-3 px-4 py-3 text-[0.86rem] font-black"
            pattern={false}
            folded={false}
            sticker={false}
            unfoldOnHover={false}
            variant="tinted"
          >
            即将进行下一局…
          </Paper>
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
            scores={state.match?.scores}
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
    <PaperSegmentGroup className="mb-3 flex flex-wrap gap-1.5" label="对局记录">
      {showCurrent ? (
        <PaperSegmentButton
          active={selectedKey === null}
          className="px-2 py-1 text-[0.7rem]"
          folded={false}
          onClick={() => onSelect(null)}
        >
          当前棋盘
        </PaperSegmentButton>
      ) : null}
      {archives.map((archive) => {
        const key = `${archive.matchIndex}:${archive.roundIndex}`;
        return (
          <PaperSegmentButton
            active={selectedKey === key}
            className="px-2 py-1 text-[0.7rem]"
            folded={false}
            key={key}
            onClick={() => onSelect(key)}
          >
            第 {archive.matchIndex + 1} 场 · 第 {archive.roundIndex} 局
          </PaperSegmentButton>
        );
      })}
    </PaperSegmentGroup>
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
  members: components["schemas"]["MemberView"][];
  fields: readonly GuessField[];
  archive: RoundEndedPayload | null;
}) {
  const forfeitedMemberId = archive?.forfeitedMemberId;
  const visibleBoards = archive
    ? boards.filter((board) =>
        isRoundArchiveParticipant(archive, board.memberId),
      )
    : boards.filter((board) => isActiveMatchMember(scores, board.memberId));
  const ordered = [...visibleBoards].sort((a, b) => a.seat - b.seat);
  const toRows = (memberId: string): GuessRow[] => {
    const board =
      boards.find((entry) => entry.memberId === memberId)?.guesses ?? [];
    const rows: GuessRow[] = board.map((guess, index) => ({
      key: `${memberId}:${guess.guessId}:${index}`,
      name: guess.guessName,
      avatarUrl: guess.guessAvatarUrl,
      isCorrect: guess.isCorrect,
      cells: guess.feedback.map((field) => ({
        field: field.field,
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
  const winnerMemberId = archive?.winnerMemberId;
  return (
    <MemberPaginator
      items={ordered}
      label="玩家棋盘"
      renderItem={(board) => {
        const winner = winnerMemberId === board.memberId;
        const eliminated = Boolean(
          archive?.eliminatedMemberIds?.includes(board.memberId),
        );
        return (
          <GuessTable
            key={board.memberId}
            title={formatBoardTitle(
              members.find((member) => member.memberId === board.memberId),
              board.seat,
            )}
            subtitle={archive ? `第 ${archive.roundIndex} 局记录` : "实时棋盘"}
            headerExtra={boardResultBadges({ winner, eliminated })}
            rows={toRows(board.memberId)}
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
        <PaperButton
          className="min-h-8"
          compact
          disabled={passDisabled}
          folded={false}
          onClick={onPass}
          title={passTitle}
        >
          <FastForward size={14} aria-hidden="true" />
          本轮空过
          <span className="tabular-nums">
            余 {relaySkipsRemaining}/{relayMaxSkips}
          </span>
        </PaperButton>
      ) : null}
      <PaperButton
        className="min-h-8"
        compact
        disabled={actionBusy !== null}
        filled={forfeitConfirm}
        folded={false}
        onClick={onForfeit}
        title={forfeitConfirm ? "再次点击确认放弃本局" : "放弃本局"}
        tone="danger"
      >
        <Flag size={14} aria-hidden="true" />
        {forfeitLabel}
      </PaperButton>
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
  if (archives.length === 0) return null;

  return (
    <div className="round-history-bar px-[18px] pt-3 pb-1">
      <ul className="flex flex-wrap gap-1.5">
        <li>
          <PaperSegmentButton
            active={selectedKey === null}
            className="px-2 py-1 text-[0.7rem]"
            folded={false}
            onClick={() => onSelect(null)}
          >
            当前局
          </PaperSegmentButton>
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
          return (
            <li key={key}>
              <PaperButton
                ariaPressed={selectedKey === key}
                className="text-[0.7rem]"
                compact
                filled={selectedKey === key}
                folded={false}
                onClick={() => onSelect(key)}
                pattern={false}
                tone={
                  result === "win"
                    ? "success"
                    : result === "loss"
                      ? "danger"
                      : "neutral"
                }
              >
                第 {archive.roundIndex} 局 ·{" "}
                {placement
                  ? `+${placement.pointsAwarded} 分${archive.eliminatedMemberIds?.includes(viewerMemberId ?? "") ? " · 已淘汰" : ""}`
                  : result === "win"
                    ? "胜"
                    : result === "loss"
                      ? "负"
                      : "平"}
              </PaperButton>
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
    <div className="guess-error-toast fixed inset-x-0 z-50 flex justify-center px-4">
      <Paper
        animateOnMount={false}
        as="div"
        className="px-4 py-2 text-[0.8rem] font-semibold"
        elevation="sm"
        pattern={false}
        tone="danger"
        folded={false}
        role="alert"
        sticker={false}
        unfoldOnHover={false}
        variant="tinted"
      >
        {message}
      </Paper>
    </div>
  );
}
