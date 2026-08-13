"use client";

// 多人房间客户端状态机（08 §10.3）：状态以事件 + 快照为唯一权威；
// 客户端不自行计算反馈；localStorage 只做恢复入口。
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Envelope,
  GameSequenceFrame,
  MatchEndedPayload,
  MatchRematchPayload,
  MatchStartedPayload,
  MultiParticipantRole,
  MultiRoomFormat,
  MultiplayerMode,
  QuestionScopeConfig,
  MultiRoomStatus,
  RoundEndedPayload,
  RoundOpponentGuessPayload,
  RoundPlayingPayload,
  RoundSpectatorGuessPayload,
  RoundSharedGuessPayload,
  RoundStartedPayload,
  RoundTurnTimeoutPayload,
  RoundTurnPassPayload,
  RoomClosedPayload,
  RoomUpdatedPayload,
} from "@touhouflandre/shared";
import type { components } from "../generated/api";
import { boardAtSeat, resultForMemberId } from "../domain/memberCollections";
import { GameSequenceCoordinator } from "../domain/gameSequence";

type GuessResult = components["schemas"]["GuessResult"];
type MatchView = components["schemas"]["MatchView"];
type MemberView = components["schemas"]["MemberView"];
type RoomSnapshot = components["schemas"]["RoomSnapshot"];
type RoundView = components["schemas"]["RoundView"];
import { ApiRequestError, api, roomWsUrl } from "../lib/api";
import { ForegroundTimer } from "../stats/timer";
import {
  loadMultiplayerTiming,
  markMultiplayerDraftIncomplete,
  recordMultiplayerEvent,
  updateMultiplayerTiming,
  type MultiplayerTimingSnapshot,
} from "../stats/multiplayerRecorder";

export type RoomConnection = "connecting" | "connected" | "reconnecting";
const SNAPSHOT_FALLBACK_INTERVAL_MS = 5000;
const CONNECTION_ISSUE_MESSAGE = "实时同步连接中断，正在自动恢复。";

export interface RoundSummary {
  roundIndex: number;
  result: "win" | "loss" | "draw";
}

export interface RoomUiState {
  connection: RoomConnection;
  connectionIssue: string | null;
  room: {
    roomId: string;
    roomCode: string;
    format: MultiRoomFormat;
    mode: MultiplayerMode;
    turnSeconds: number;
    playerLimit: number;
    minPlayers: number;
    playerCount: number;
    availableSeats: number;
    status: MultiRoomStatus;
    expiresAt: string;
    spectatorCount: number;
  } | null;
  viewer: components["schemas"]["ParticipantView"] | null;
  members: MemberView[];
  match: MatchView | null;
  round: RoundView | null;
  /** 本局绑定题库版本（match.started 载荷；本地角色表按版本键缓存）。 */
  catalogVersion: string | null;
  /** 本场绑定的题库范围；只影响本场展示和统计，不写入本地题库设置。 */
  questionScope: QuestionScopeConfig | null;
  /** 局末弹窗数据（round.ended 事件）。 */
  roundResult: RoundEndedPayload | null;
  /** 整场结果弹窗数据（match.ended 事件）。 */
  matchResult: MatchEndedPayload | null;
  /** 对方确认再来一局（索引 0/1 对应 slot 1/2）。 */
  rematchReady: [boolean, boolean];
  /** 历史局摘要（第 N 局 胜/负/平）。 */
  history: RoundSummary[];
  /** 房间保留期内完整局末记录，供观战/复盘选择。 */
  roundArchives: RoundEndedPayload[];
  appliedGameSequence: number;
}

export const initialRoomState: RoomUiState = {
  connection: "connecting",
  connectionIssue: null,
  room: null,
  viewer: null,
  members: [],
  match: null,
  round: null,
  catalogVersion: null,
  questionScope: null,
  roundResult: null,
  matchResult: null,
  rematchReady: [false, false],
  history: [],
  roundArchives: [],
  appliedGameSequence: 0,
};

/** 局结束 → 历史摘要与比分。 */
function roundSummary(result: string): "win" | "loss" | "draw" {
  if (result === "win" || result === "loss" || result === "draw") return result;
  return "draw";
}

/** 按 sequence 应用事件（08 §10.3 reducer；乱序/重复由调用方去重）。 */
export function roomReducer(state: RoomUiState, event: Envelope): RoomUiState {
  switch (event.type) {
    case "room.updated": {
      const payload = event.payload as unknown as RoomUpdatedPayload;
      return {
        ...state,
        members: payload.members,
        room: state.room
          ? {
              ...state.room,
              format: payload.format,
              mode: payload.mode,
              turnSeconds: payload.turnSeconds,
              playerLimit: payload.playerLimit,
              minPlayers: payload.minPlayers,
              playerCount: payload.playerCount,
              availableSeats: payload.availableSeats,
              spectatorCount: payload.spectatorCount,
            }
          : state.room,
      };
    }
    case "match.started": {
      const payload = event.payload as unknown as MatchStartedPayload;
      // 新场：比分/抽题池自然重置（服务端新场行），本地同步清零并清空历史
      return {
        ...state,
        catalogVersion: payload.catalogVersion ?? null,
        questionScope: payload.questionScope ?? state.questionScope,
        room: state.room
          ? {
              ...state.room,
              status: "playing",
              mode: payload.mode,
              turnSeconds: payload.turnSeconds,
            }
          : state.room,
        match: {
          matchIndex: payload.matchIndex,
          targetWins: payload.targetWins,
          scores: state.members.map((member) => ({
            memberId: member.memberId,
            seat: member.seat,
            score: 0,
          })),
          roundIndex: 0,
          maxRounds: maxRoundsFor(payload.format),
          rematchReady: state.members.map((member) => ({
            memberId: member.memberId,
            seat: member.seat,
            ready: false,
          })),
          catalogVersion: payload.catalogVersion,
        },
        round: null,
        roundResult: null,
        matchResult: null,
        rematchReady: [false, false],
        history: [],
      };
    }
    case "match.rematch": {
      const payload = event.payload as unknown as MatchRematchPayload;
      const rematchReady: [boolean, boolean] = [...state.rematchReady];
      rematchReady[payload.seat - 1] = true;
      return { ...state, rematchReady };
    }
    case "round.started": {
      const payload = event.payload as unknown as RoundStartedPayload;
      const viewerMemberId = state.viewer?.memberId;
      const viewerSeat = state.viewer?.seat;
      const isPlayer = state.viewer?.role === "player";
      // 新局棋盘就绪；roundResult 保留到 round.playing（局末弹窗显示下一局倒计时）
      return {
        ...state,
        round: {
          status: "countdown",
          startsAt: payload.startsAt,
          deadline: payload.deadline,
          maxGuesses: payload.maxGuesses,
          maxTurnsPerPlayer: payload.maxTurnsPerPlayer,
          maxSkipsPerPlayer: payload.maxSkipsPerPlayer,
          turnMemberId: payload.turnMemberId,
          turnSeat: payload.turnSeat,
          turnDeadline: payload.turnDeadline,
          self: {
            ...(isPlayer && viewerMemberId ? { memberId: viewerMemberId } : {}),
            ...(isPlayer && viewerSeat ? { seat: viewerSeat } : {}),
            guesses: [],
          },
          opponents: isPlayer
            ? state.members
                .filter((member) => member.memberId !== viewerMemberId)
                .map((member) => ({
                  memberId: member.memberId,
                  seat: member.seat,
                  rows: [],
                }))
            : [],
          ...(isPlayer
            ? {}
            : {
                boards: state.members.map((member) => ({
                  memberId: member.memberId,
                  seat: member.seat,
                  guesses: [],
                })),
              }),
          ...(payload.maxTurnsPerPlayer ? { shared: { rows: [] } } : {}),
        },
        match: state.match
          ? { ...state.match, roundIndex: payload.roundIndex }
          : state.match,
      };
    }
    case "round.playing": {
      const _ = event.payload as unknown as RoundPlayingPayload;
      return {
        ...state,
        round: state.round
          ? { ...state.round, status: "playing" }
          : state.round,
        roundResult: null, // 到点强制开新局，弹窗关闭
      };
    }
    case "round.opponent.guess": {
      const payload = event.payload as unknown as RoundOpponentGuessPayload;
      if (!state.round) return state;
      return {
        ...state,
        round: {
          ...state.round,
          opponents: state.round.opponents.map((opponent) =>
            opponent.memberId === payload.memberId
              ? {
                  ...opponent,
                  rows: [
                    ...opponent.rows,
                    { index: payload.rowIndex, statuses: payload.statuses },
                  ],
                }
              : opponent,
          ),
        },
      };
    }
    case "round.spectator.guess": {
      const payload = event.payload as unknown as RoundSpectatorGuessPayload;
      if (!state.round) return state;
      const boards =
        state.round.boards ??
        state.members.map((member) => ({
          memberId: member.memberId,
          seat: member.seat,
          guesses: [],
        }));
      return {
        ...state,
        round: {
          ...state.round,
          boards: boards.map((board) =>
            board.memberId === payload.memberId
              ? { ...board, guesses: [...board.guesses, payload.guess] }
              : board,
          ),
        },
      };
    }
    case "round.shared.guess": {
      const payload = event.payload as unknown as RoundSharedGuessPayload;
      if (!state.round) return state;
      return {
        ...state,
        round: {
          ...state.round,
          shared: {
            rows: [...(state.round.shared?.rows ?? []), payload.row],
          },
          turnMemberId: payload.nextTurnMemberId,
          turnSeat: payload.nextTurnSeat,
          turnDeadline: payload.nextTurnDeadline,
        },
      };
    }
    case "round.turn.timeout": {
      const payload = event.payload as unknown as RoundTurnTimeoutPayload;
      if (!state.round) return state;
      return {
        ...state,
        round: {
          ...state.round,
          shared: {
            rows: [...(state.round.shared?.rows ?? []), payload.row],
          },
          turnMemberId: payload.nextTurnMemberId,
          turnSeat: payload.nextTurnSeat,
          turnDeadline: payload.nextTurnDeadline,
        },
      };
    }
    case "round.turn.pass": {
      const payload = event.payload as unknown as RoundTurnPassPayload;
      if (!state.round) return state;
      return {
        ...state,
        round: {
          ...state.round,
          shared: {
            rows: [...(state.round.shared?.rows ?? []), payload.row],
          },
          turnMemberId: payload.nextTurnMemberId,
          turnSeat: payload.nextTurnSeat,
          turnDeadline: payload.nextTurnDeadline,
        },
      };
    }
    case "round.ended": {
      const payload = event.payload as unknown as RoundEndedPayload;
      return {
        ...state,
        round: state.round
          ? {
              ...state.round,
              status: "ended",
              ...(payload.turns ? { shared: { rows: payload.turns } } : {}),
              turnMemberId: undefined,
              turnSeat: undefined,
              turnDeadline: undefined,
            }
          : state.round,
        roundResult: payload,
        history: [
          ...state.history,
          {
            roundIndex: payload.roundIndex,
            result: roundSummary(
              payload.viewerResult ??
                resultForMemberId(payload.results, state.viewer?.memberId) ??
                "draw",
            ),
          },
        ],
        roundArchives: [
          ...state.roundArchives.filter(
            (archive) =>
              !(
                archive.matchIndex === payload.matchIndex &&
                archive.roundIndex === payload.roundIndex
              ),
          ),
          payload,
        ],
        match: state.match
          ? {
              ...state.match,
              scores: payload.scores,
            }
          : state.match,
      };
    }
    case "match.ended": {
      const payload = event.payload as unknown as MatchEndedPayload;
      return {
        ...state,
        matchResult: payload,
        match: state.match
          ? {
              ...state.match,
              scores: payload.scores,
            }
          : state.match,
        room: state.room
          ? {
              ...state.room,
              status: "finished",
              expiresAt: payload.retentionEndsAt,
            }
          : state.room,
      };
    }
    case "room.closed": {
      const _ = event.payload as unknown as RoomClosedPayload;
      return {
        ...state,
        room: state.room ? { ...state.room, status: "closed" } : state.room,
      };
    }
    default:
      return state;
  }
}

/** 赛制 → 总局数安全上限（与后端 multi.MaxRounds 一致）。 */
export function maxRoundsFor(format: MultiRoomFormat): number {
  const n =
    format === "bo1" ? 1 : format === "bo3" ? 3 : format === "bo5" ? 5 : 7;
  return 3 * n;
}

/** 快照应用：状态（room/members/match/round 权威视图）+ 事件回放（去重）。 */
export function applySnapshot(
  state: RoomUiState,
  snapshot: RoomSnapshot,
): RoomUiState {
  // 先回放事件（历史摘要/比分），后置权威状态（room/members/match/round）
  // ——避免事件回放（如 match.started 的重置语义）覆盖快照状态。
  let next: RoomUiState = { ...state };
  for (const event of snapshot.events) {
    if (event.sequence <= next.appliedGameSequence) continue;
    next = roomReducer(next, event);
    next.appliedGameSequence = event.sequence;
  }
  return {
    ...next,
    room: {
      roomId: snapshot.roomId,
      roomCode: snapshot.roomCode,
      format: snapshot.format,
      mode: snapshot.mode,
      turnSeconds: snapshot.turnSeconds,
      playerLimit: snapshot.playerLimit,
      minPlayers: snapshot.minPlayers,
      playerCount: snapshot.playerCount,
      availableSeats: snapshot.availableSeats,
      status: snapshot.status,
      expiresAt: snapshot.expiresAt,
      spectatorCount: snapshot.spectatorCount,
    },
    viewer: snapshot.viewer,
    members: snapshot.members,
    match: snapshot.match ?? null,
    catalogVersion: snapshot.match?.catalogVersion ?? next.catalogVersion,
    questionScope: (snapshot.match?.questionScope ??
      snapshot.questionScope ??
      next.questionScope) as QuestionScopeConfig | null,
    round: snapshot.round ?? null,
    rematchReady: snapshot.match
      ? [
          snapshot.match.rematchReady.find((member) => member.seat === 1)
            ?.ready ?? false,
          snapshot.match.rematchReady.find((member) => member.seat === 2)
            ?.ready ?? false,
        ]
      : [false, false],
    appliedGameSequence: Math.max(
      next.appliedGameSequence,
      snapshot.gameSequence,
    ),
  };
}

export interface RoomActions {
  setReady: () => Promise<void>;
  leave: () => Promise<void>;
  rematch: () => Promise<void>;
  submitGuess: (guessId: string) => Promise<void>;
  forfeitRound: () => Promise<void>;
  passRelayTurn: () => Promise<void>;
}

export interface UseRoomResult {
  state: RoomUiState;
  /** 自身席位（1 = 房主；来自创建/加入响应，随 localStorage 持久化）。 */
  mySlot: 1 | 2 | null;
  role: MultiParticipantRole;
  actions: RoomActions;
  /** 提交猜测错误（toast 展示）。 */
  guessError: string;
  roomUnavailable: boolean;
}

/**
 * useRoom：权威快照 → v2 hello{lastGameSequence} → 连续业务/cursor 游戏帧；
 * 真缺口由单个 snapshot 对齐，断线指数退避重连携带已应用游戏水位。
 */
export function useRoom(
  roomId: string,
  token: string,
  mySlot: 1 | 2 | null,
  role: MultiParticipantRole = "player",
): UseRoomResult {
  const [state, setState] = useState<RoomUiState>(initialRoomState);
  const [guessError, setGuessError] = useState("");
  const [roomUnavailable, setRoomUnavailable] = useState(false);
  const lastAppliedRef = useRef(0);
  const completedGameSequenceRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ForegroundTimer | null>(null);
  const guessCompletedRef = useRef<number[]>([]);
  const pendingGuessRef = useRef<number | null>(null);
  const statsQueueRef = useRef<Promise<void>>(Promise.resolve());
  const isSpectator = role === "spectator" || mySlot === null;
  const playerSlot: 1 | 2 = mySlot ?? 1;

  if (timerRef.current === null) timerRef.current = new ForegroundTimer();

  const queueStatsEvent = useCallback(
    (event: Envelope, timing?: MultiplayerTimingSnapshot) => {
      if (isSpectator) return Promise.resolve();
      const queued = statsQueueRef.current.then(() =>
        recordMultiplayerEvent(event, playerSlot, timing),
      );
      statsQueueRef.current = queued.catch((error) => {
        console.error("本地多人统计写入失败", error);
      });
      return queued;
    },
    [isSpectator, playerSlot],
  );

  const applyEvent = useCallback(
    (event: Envelope) => {
      let timing: MultiplayerTimingSnapshot | undefined;
      if (event.type === "match.started" || event.type === "round.started") {
        timerRef.current?.setActive(false);
        timerRef.current?.reset(0);
        guessCompletedRef.current = [];
        pendingGuessRef.current = null;
      } else if (event.type === "round.playing") {
        timerRef.current?.setActive(true);
      } else if (event.type === "round.ended") {
        const payload = event.payload as unknown as RoundEndedPayload;
        const board = boardAtSeat(payload.boards, playerSlot);
        if (
          pendingGuessRef.current !== null &&
          guessCompletedRef.current.length < board.length
        ) {
          guessCompletedRef.current = [
            ...guessCompletedRef.current,
            pendingGuessRef.current,
          ];
        }
        timing = {
          activeElapsedMs: timerRef.current?.snapshot() ?? 0,
          guessCompletedElapsedMs: [...guessCompletedRef.current],
        };
        timerRef.current?.setActive(false);
        pendingGuessRef.current = null;
      } else if (event.type === "match.ended") {
        timerRef.current?.setActive(false);
      }
      void queueStatsEvent(event, timing);
      setState((s) => ({
        ...roomReducer(s, event),
        appliedGameSequence: event.sequence,
      }));
    },
    [playerSlot, queueStatsEvent],
  );

  const syncSnapshot = useCallback(
    async (snapshot: RoomSnapshot) => {
      for (const event of snapshot.events) {
        if (event.sequence <= lastAppliedRef.current) continue;
        void queueStatsEvent(event as Envelope);
      }
      setState((current) => applySnapshot(current, snapshot));
      lastAppliedRef.current = Math.max(
        lastAppliedRef.current,
        snapshot.gameSequence,
      );
      completedGameSequenceRef.current = Math.max(
        completedGameSequenceRef.current,
        snapshot.gameSequence,
      );
      await statsQueueRef.current;
      if (
        !isSpectator &&
        snapshot.match &&
        snapshot.round?.status === "playing"
      ) {
        const timing = await loadMultiplayerTiming(
          snapshot.roomId,
          snapshot.match.matchIndex,
          playerSlot,
        );
        timerRef.current?.reset(timing?.activeElapsedMs ?? 0);
        guessCompletedRef.current = timing?.guessCompletedElapsedMs ?? [];
        timerRef.current?.setActive(true);
      } else {
        timerRef.current?.setActive(false);
      }
    },
    [isSpectator, playerSlot, queueStatsEvent],
  );

  useEffect(() => {
    if (!roomId) return; // 无成员资格：空 roomId 不发起请求，等页面重定向
    let disposed = false;
    let retry = 0;
    let fallbackIntervalId: number | undefined;
    let fallbackInFlight = false;

    const markUnavailable = async () => {
      await markMultiplayerDraftIncomplete(roomId, playerSlot);
      if (!disposed) setRoomUnavailable(true);
    };

    const syncFallbackSnapshot = async () => {
      if (disposed || fallbackInFlight) return;
      fallbackInFlight = true;
      try {
        const snapshot = await api.roomSnapshot(
          roomId,
          token,
          lastAppliedRef.current,
        );
        if (!disposed) await syncSnapshot(snapshot);
      } catch (error) {
        if (
          error instanceof ApiRequestError &&
          (error.status === 401 || error.status === 404)
        ) {
          await markUnavailable();
        }
      } finally {
        fallbackInFlight = false;
      }
    };

    const startSnapshotFallback = () => {
      if (fallbackIntervalId !== undefined) return;
      void syncFallbackSnapshot();
      fallbackIntervalId = window.setInterval(() => {
        void syncFallbackSnapshot();
      }, SNAPSHOT_FALLBACK_INTERVAL_MS);
    };

    const stopSnapshotFallback = () => {
      if (fallbackIntervalId === undefined) return;
      window.clearInterval(fallbackIntervalId);
      fallbackIntervalId = undefined;
    };

    const connect = (lastGameSequence: number) => {
      if (disposed) return;
      setState((s) => ({
        ...s,
        connection: lastGameSequence === 0 ? "connecting" : "reconnecting",
      }));
      let ws: WebSocket;
      try {
        ws = new WebSocket(roomWsUrl(roomId), "touhouflandre-multi.v2");
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;
      const coordinator = new GameSequenceCoordinator(
        lastAppliedRef.current,
        {
          applyEvent,
          advance: (sequence) => {
            lastAppliedRef.current = sequence;
            setState((current) => ({
              ...current,
              appliedGameSequence: sequence,
            }));
          },
          persist: (sequence) => {
            completedGameSequenceRef.current = sequence;
          },
          resync: async (after) => {
            const snapshot = await api.roomSnapshot(roomId, token, after);
            if (disposed) return lastAppliedRef.current;
            await syncSnapshot(snapshot);
            return snapshot.gameSequence;
          },
          onResyncError: () => startSnapshotFallback(),
        },
        completedGameSequenceRef.current,
      );
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "hello",
            token,
            lastGameSequence,
          }),
        );
      };
      ws.onmessage = (e) => {
        let msg: GameSequenceFrame & {
          targetGameSequence?: number;
          gameSequence?: number;
        };
        try {
          msg = JSON.parse(e.data as string);
        } catch {
          return;
        }
        if (msg.type === "hello-ok") {
          retry = 0;
          stopSnapshotFallback();
          return;
        }
        if (msg.type === "sync.complete") {
          if (typeof msg.gameSequence === "number") {
            coordinator.complete(msg.gameSequence);
          }
          setState((s) => ({
            ...s,
            connection: "connected",
            connectionIssue: null,
          }));
          return;
        }
        if (msg.type === "resync.required") {
          void api
            .roomSnapshot(roomId, token, 0)
            .then(async (snapshot) => {
              if (disposed) return;
              await syncSnapshot(snapshot);
              coordinator.align(snapshot.gameSequence);
            })
            .finally(() => ws.close());
          return;
        }
        if (msg.type === "replaced") {
          ws.close();
          return;
        }
        if (typeof msg.sequence === "number") coordinator.receive(msg);
      };
      ws.onclose = () => {
        wsRef.current = null;
        if (disposed) return;
        scheduleReconnect();
      };
      ws.onerror = () => {
        ws.close();
      };
    };

    const scheduleReconnect = () => {
      setState((s) => ({
        ...s,
        connection: "reconnecting",
        connectionIssue: CONNECTION_ISSUE_MESSAGE,
      }));
      startSnapshotFallback();
      const delay =
        Math.min(1000 * 2 ** retry, 30000) * (0.8 + Math.random() * 0.4);
      retry += 1;
      window.setTimeout(() => connect(completedGameSequenceRef.current), delay);
    };

    // 先建连（hello → hello-ok → 重放），快照在 hello-ok 后拉取（自视角棋盘/权威状态）。
    // 实测：Chromium 在整页加载（含刷新）期间创建的 WS 握手会被延迟数十秒，
    // load 事件后创建瞬时完成——首次连接等页面加载完再发起。
    const start = async () => {
      if (disposed) return;
      try {
        const snapshot = await api.roomSnapshot(roomId, token, 0);
        if (disposed) return;
        await syncSnapshot(snapshot);
        const self = snapshot.members.find(
          (member: MemberView) => member.seat === playerSlot,
        );
        if (self?.status === "left" || snapshot.status === "closed") {
          setState((current) => ({ ...current, connection: "connected" }));
          return;
        }
      } catch (error) {
        if (
          error instanceof ApiRequestError &&
          (error.status === 401 || error.status === 404)
        ) {
          await markUnavailable();
          return;
        }
      }
      if (!disposed) connect(completedGameSequenceRef.current);
    };
    if (document.readyState === "loading") {
      window.addEventListener("load", start, { once: true });
    } else {
      start();
    }

    return () => {
      disposed = true;
      stopSnapshotFallback();
      window.removeEventListener("load", start);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [roomId, token, playerSlot, applyEvent, syncSnapshot]);

  useEffect(() => {
    const timer = timerRef.current;
    return () => timer?.destroy();
  }, []);

  useEffect(() => {
    if (
      isSpectator ||
      !roomId ||
      !state.match ||
      state.round?.status !== "playing"
    )
      return;
    const flush = () => {
      const timing = {
        activeElapsedMs: timerRef.current?.snapshot() ?? 0,
        guessCompletedElapsedMs: [...guessCompletedRef.current],
      };
      void updateMultiplayerTiming(
        roomId,
        state.match!.matchIndex,
        playerSlot,
        timing,
      );
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isSpectator, roomId, state.match, state.round?.status, playerSlot]);

  const actions: RoomActions = {
    setReady: async () => {
      try {
        await api.setReady(roomId, token, true);
      } catch (e) {
        setGuessError(e instanceof Error ? e.message : "就绪失败。");
      }
    },
    leave: async () => {
      try {
        if (state.match && state.round?.status === "playing") {
          await updateMultiplayerTiming(
            roomId,
            state.match.matchIndex,
            playerSlot,
            {
              activeElapsedMs: timerRef.current?.snapshot() ?? 0,
              guessCompletedElapsedMs: [...guessCompletedRef.current],
            },
          );
        }
        const self = state.members.find((member) => member.seat === playerSlot);
        if (self?.status !== "left") await api.leaveRoom(roomId, token);
        const snapshot = await api.roomSnapshot(roomId, token, 0);
        await syncSnapshot(snapshot);
        await statsQueueRef.current;
      } catch (e) {
        setGuessError(e instanceof Error ? e.message : "离开失败。");
      }
    },
    rematch: async () => {
      try {
        await api.rematch(roomId, token);
      } catch (e) {
        setGuessError(e instanceof Error ? e.message : "再来一局失败。");
      }
    },
    submitGuess: async (guessId: string) => {
      setGuessError("");
      if (
        isSpectator ||
        !state.round ||
        state.round.status !== "playing" ||
        !state.match
      )
        return;
      const idempotencyKey = crypto.randomUUID();
      const completedElapsedMs = timerRef.current?.snapshot() ?? 0;
      const isRelay = state.room?.mode === "relay";
      const completedGuessCount = isRelay
        ? (state.round.shared?.rows.filter(
            (row) => row.kind === "guess" && row.seat === playerSlot,
          ).length ?? 0)
        : state.round.self.guesses.length;
      const expectedGuessCount = completedGuessCount + 1;
      pendingGuessRef.current = completedElapsedMs;
      try {
        const resp = await api.submitMultiGuess(
          roomId,
          token,
          state.match.roundIndex,
          guessId,
          idempotencyKey,
        );
        if (guessCompletedRef.current.length < expectedGuessCount) {
          guessCompletedRef.current = [
            ...guessCompletedRef.current,
            completedElapsedMs,
          ];
        }
        pendingGuessRef.current = null;
        await updateMultiplayerTiming(
          roomId,
          state.match.matchIndex,
          playerSlot,
          {
            activeElapsedMs: completedElapsedMs,
            guessCompletedElapsedMs: [...guessCompletedRef.current],
          },
        );
        if (!isRelay) {
          // 竞速自视角无事件回放：本地追加（08 §10.2）
          setState((s) =>
            s.round
              ? {
                  ...s,
                  round: {
                    ...s.round,
                    self: { guesses: [...s.round.self.guesses, resp.guess] },
                  },
                }
              : s,
          );
        }
      } catch (e) {
        pendingGuessRef.current = null;
        setGuessError(e instanceof Error ? e.message : "猜测失败。");
      }
    },
    forfeitRound: async () => {
      setGuessError("");
      pendingGuessRef.current = null;
      if (
        isSpectator ||
        !state.round ||
        state.round.status !== "playing" ||
        !state.match
      )
        return;
      try {
        await api.forfeitRound(roomId, token, state.match.roundIndex);
      } catch (e) {
        setGuessError(e instanceof Error ? e.message : "放弃本局失败。");
      }
    },
    passRelayTurn: async () => {
      setGuessError("");
      pendingGuessRef.current = null;
      if (
        isSpectator ||
        !state.round ||
        state.round.status !== "playing" ||
        !state.match ||
        state.room?.mode !== "relay"
      ) {
        return;
      }
      try {
        await api.passRelayTurn(roomId, token, state.match.roundIndex);
      } catch (e) {
        setGuessError(e instanceof Error ? e.message : "空过失败。");
      }
    },
  };

  return { state, mySlot, role, actions, guessError, roomUnavailable };
}
