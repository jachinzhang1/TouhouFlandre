"use client";

// 多人房间客户端状态机（08 §10.3）：状态以事件 + 快照为唯一权威；
// 客户端不自行计算反馈；localStorage 只做恢复入口。
import { useCallback, useEffect, useRef, useState } from "react";
import type { Envelope, RoundEndedPayload } from "@touhouflandre/shared";
import {
  applySnapshot,
  initialRoomState,
  roomReducer,
  type RoomUiState,
} from "../domain/roomState";
import type { components } from "../generated/api";

type RoomSnapshot = components["schemas"]["RoomSnapshot"];
import { ApiRequestError, api, roomWsUrl } from "../lib/api";
import { ForegroundTimer } from "../stats/timer";
import {
  loadMultiplayerTiming,
  markMultiplayerDraftIncomplete,
  recordMultiplayerEvent,
  updateMultiplayerTiming,
  type MultiplayerTimingSnapshot,
} from "../stats/multiplayerRecorder";
const SNAPSHOT_FALLBACK_INTERVAL_MS = 5000;
const CONNECTION_ISSUE_MESSAGE = "实时同步连接中断，正在自动恢复。";

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
  mySlot: 1 | 2;
  actions: RoomActions;
  /** 提交猜测错误（toast 展示）。 */
  guessError: string;
  roomUnavailable: boolean;
}

/**
 * useRoom：快照对齐 → 连接 → hello{token, lastSequence} → 事件流；
 * 断线指数退避重连（1s→…→30s + 抖动）携带 lastAppliedSeq（08 §8.4）。
 */
export function useRoom(
  roomId: string,
  token: string,
  mySlot: 1 | 2,
): UseRoomResult {
  const [state, setState] = useState<RoomUiState>(initialRoomState);
  const [guessError, setGuessError] = useState("");
  const [roomUnavailable, setRoomUnavailable] = useState(false);
  const lastAppliedRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ForegroundTimer | null>(null);
  const guessCompletedRef = useRef<number[]>([]);
  const pendingGuessRef = useRef<number | null>(null);
  const statsQueueRef = useRef<Promise<void>>(Promise.resolve());

  if (timerRef.current === null) timerRef.current = new ForegroundTimer();

  const queueStatsEvent = useCallback(
    (event: Envelope, timing?: MultiplayerTimingSnapshot) => {
      const queued = statsQueueRef.current.then(() =>
        recordMultiplayerEvent(event, mySlot, timing),
      );
      statsQueueRef.current = queued.catch((error) => {
        console.error("本地多人统计写入失败", error);
      });
      return queued;
    },
    [mySlot],
  );

  const applyEvent = useCallback(
    (event: Envelope) => {
      if (event.sequence <= lastAppliedRef.current) return; // 按 sequence 去重
      lastAppliedRef.current = event.sequence;
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
        const board =
          mySlot === 1 ? payload.boards.slot1 : payload.boards.slot2;
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
        lastSequence: event.sequence,
      }));
    },
    [mySlot, queueStatsEvent],
  );

  const syncSnapshot = useCallback(
    async (snapshot: RoomSnapshot) => {
      for (const event of snapshot.events) {
        if (event.sequence <= lastAppliedRef.current) continue;
        lastAppliedRef.current = event.sequence;
        void queueStatsEvent(event as Envelope);
      }
      setState((current) => applySnapshot(current, snapshot));
      await statsQueueRef.current;
      if (snapshot.match && snapshot.round?.status === "playing") {
        const timing = await loadMultiplayerTiming(
          snapshot.roomId,
          snapshot.match.matchIndex,
          mySlot,
        );
        timerRef.current?.reset(timing?.activeElapsedMs ?? 0);
        guessCompletedRef.current = timing?.guessCompletedElapsedMs ?? [];
        timerRef.current?.setActive(true);
      } else {
        timerRef.current?.setActive(false);
      }
    },
    [mySlot, queueStatsEvent],
  );

  useEffect(() => {
    if (!roomId) return; // 无成员资格：空 roomId 不发起请求，等页面重定向
    let disposed = false;
    let retry = 0;
    let fallbackIntervalId: number | undefined;
    let fallbackInFlight = false;

    const markUnavailable = async () => {
      await markMultiplayerDraftIncomplete(roomId, mySlot);
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

    const connect = (lastSequence: number) => {
      if (disposed) return;
      setState((s) => ({
        ...s,
        connection: lastSequence === 0 ? "connecting" : "reconnecting",
      }));
      let ws: WebSocket;
      try {
        ws = new WebSocket(roomWsUrl(roomId), "touhouflandre-multi.v1");
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "hello",
            token,
            lastSequence: lastAppliedRef.current,
          }),
        );
      };
      ws.onmessage = (e) => {
        let msg: Envelope & { nextSequence?: number };
        try {
          msg = JSON.parse(e.data as string);
        } catch {
          return;
        }
        if (msg.type === "hello-ok") {
          retry = 0;
          stopSnapshotFallback();
          setState((s) => ({
            ...s,
            connection: "connected",
            connectionIssue: null,
          }));
          // 快照对齐（room/members/match/round 权威视图 + 历史事件）；
          // 重放事件由服务端在 hello-ok 后推送，reducer 按 sequence 去重。
          api
            .roomSnapshot(roomId, token, 0)
            .then(async (snapshot) => {
              if (disposed) return;
              await syncSnapshot(snapshot);
            })
            .catch(() => {
              // 房间不存在/令牌失效：保持当前状态，由页面按连接状态兜底
            });
          return;
        }
        if (msg.type === "replaced") {
          ws.close();
          return;
        }
        applyEvent(msg);
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
      window.setTimeout(() => connect(lastAppliedRef.current), delay);
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
        const self = snapshot.members.find((member) => member.slot === mySlot);
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
      if (!disposed) connect(lastAppliedRef.current);
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
  }, [roomId, token, mySlot, applyEvent, syncSnapshot]);

  useEffect(() => {
    const timer = timerRef.current;
    return () => timer?.destroy();
  }, []);

  useEffect(() => {
    if (!roomId || !state.match || state.round?.status !== "playing") return;
    const flush = () => {
      const timing = {
        activeElapsedMs: timerRef.current?.snapshot() ?? 0,
        guessCompletedElapsedMs: [...guessCompletedRef.current],
      };
      void updateMultiplayerTiming(
        roomId,
        state.match!.matchIndex,
        mySlot,
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
  }, [roomId, state.match, state.round?.status, mySlot]);

  const actions: RoomActions = {
    setReady: async () => {
      try {
        await api.setReady(roomId, token);
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
            mySlot,
            {
              activeElapsedMs: timerRef.current?.snapshot() ?? 0,
              guessCompletedElapsedMs: [...guessCompletedRef.current],
            },
          );
        }
        const self = state.members.find((member) => member.slot === mySlot);
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
      if (!state.round || state.round.status !== "playing" || !state.match)
        return;
      const idempotencyKey = crypto.randomUUID();
      const completedElapsedMs = timerRef.current?.snapshot() ?? 0;
      const isRelay = state.room?.mode === "relay";
      const completedGuessCount = isRelay
        ? (state.round.shared?.rows.filter(
            (row) => row.kind === "guess" && row.memberSlot === mySlot,
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
        await updateMultiplayerTiming(roomId, state.match.matchIndex, mySlot, {
          activeElapsedMs: completedElapsedMs,
          guessCompletedElapsedMs: [...guessCompletedRef.current],
        });
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
      if (!state.round || state.round.status !== "playing" || !state.match)
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

  return { state, mySlot, actions, guessError, roomUnavailable };
}
