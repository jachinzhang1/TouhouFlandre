"use client";

// 多人房间客户端状态机（08 §10.3）：状态以事件 + 快照为唯一权威；
// 客户端不自行计算反馈；localStorage 只做恢复入口。
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Envelope,
  MatchEndedPayload,
  MatchRematchPayload,
  MatchStartedPayload,
  MultiRoomFormat,
  MultiRoomStatus,
  RoundEndedPayload,
  RoundOpponentGuessPayload,
  RoundPlayingPayload,
  RoundStartedPayload,
  RoomClosedPayload,
  RoomUpdatedPayload,
} from "@touhouflandre/shared";
import type { components } from "../generated/api";

type GuessResult = components["schemas"]["GuessResult"];
type MatchView = components["schemas"]["MatchView"];
type MemberView = components["schemas"]["MemberView"];
type RoomSnapshot = components["schemas"]["RoomSnapshot"];
type RoundView = components["schemas"]["RoundView"];
import { api, roomWsUrl } from "../lib/api";

export type RoomConnection = "connecting" | "connected" | "reconnecting";

export interface RoundSummary {
  roundIndex: number;
  result: "win" | "loss" | "draw";
}

export interface RoomUiState {
  connection: RoomConnection;
  room: { roomId: string; roomCode: string; format: MultiRoomFormat; status: MultiRoomStatus } | null;
  members: MemberView[];
  match: MatchView | null;
  round: RoundView | null;
  /** 局末弹窗数据（round.ended 事件）。 */
  roundResult: RoundEndedPayload | null;
  /** 整场结果弹窗数据（match.ended 事件）。 */
  matchResult: MatchEndedPayload | null;
  /** 对方确认再来一局（索引 0/1 对应 slot 1/2）。 */
  rematchReady: [boolean, boolean];
  /** 历史局摘要（第 N 局 胜/负/平）。 */
  history: RoundSummary[];
  lastSequence: number;
}

export const initialRoomState: RoomUiState = {
  connection: "connecting",
  room: null,
  members: [],
  match: null,
  round: null,
  roundResult: null,
  matchResult: null,
  rematchReady: [false, false],
  history: [],
  lastSequence: 0,
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
          ? { ...state.room, format: payload.format }
          : state.room,
      };
    }
    case "match.started": {
      const payload = event.payload as unknown as MatchStartedPayload;
      // 新场：比分/抽题池自然重置（服务端新场行），本地同步清零并清空历史
      return {
        ...state,
        room: state.room ? { ...state.room, status: "playing" } : state.room,
        match: {
          matchIndex: payload.matchIndex,
          targetWins: payload.targetWins,
          scoreSlot1: 0,
          scoreSlot2: 0,
          roundIndex: 0,
          maxRounds: maxRoundsFor(payload.format),
          rematchReady: [false, false],
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
      rematchReady[payload.memberSlot - 1] = true;
      return { ...state, rematchReady };
    }
    case "round.started": {
      const payload = event.payload as unknown as RoundStartedPayload;
      // 新局棋盘就绪；roundResult 保留到 round.playing（局末弹窗显示下一局倒计时）
      return {
        ...state,
        round: {
          status: "countdown",
          startsAt: payload.startsAt,
          deadline: payload.deadline,
          maxGuesses: payload.maxGuesses,
          self: { guesses: [] },
          opponent: { rows: [] },
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
        round: state.round ? { ...state.round, status: "playing" } : state.round,
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
          opponent: {
            ...state.round.opponent,
            rows: [
              ...state.round.opponent.rows,
              { index: payload.rowIndex, statuses: payload.statuses },
            ],
          },
        },
      };
    }
    case "round.ended": {
      const payload = event.payload as unknown as RoundEndedPayload;
      return {
        ...state,
        round: state.round ? { ...state.round, status: "ended" } : state.round,
        roundResult: payload,
        history: [
          ...state.history,
          { roundIndex: payload.roundIndex, result: roundSummary(payload.result) },
        ],
        match: state.match
          ? {
              ...state.match,
              scoreSlot1: payload.scores.slot1,
              scoreSlot2: payload.scores.slot2,
            }
          : state.match,
      };
    }
    case "match.ended": {
      const payload = event.payload as unknown as MatchEndedPayload;
      return {
        ...state,
        matchResult: payload,
        round: null,
        roundResult: null,
        match: state.match
          ? {
              ...state.match,
              scoreSlot1: payload.scores.slot1,
              scoreSlot2: payload.scores.slot2,
            }
          : state.match,
        room: state.room ? { ...state.room, status: "finished" } : state.room,
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
  const n = format === "bo1" ? 1 : format === "bo3" ? 3 : format === "bo5" ? 5 : 7;
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
    if (event.sequence <= next.lastSequence) continue;
    next = roomReducer(next, event);
    next.lastSequence = event.sequence;
  }
  return {
    ...next,
    room: {
      roomId: snapshot.roomId,
      roomCode: snapshot.roomCode,
      format: snapshot.format,
      status: snapshot.status,
    },
    members: snapshot.members,
    match: snapshot.match ?? null,
    round: snapshot.round ?? null,
    rematchReady: snapshot.match
      ? [snapshot.match.rematchReady[0] ?? false, snapshot.match.rematchReady[1] ?? false]
      : [false, false],
  };
}

export interface RoomActions {
  setReady: () => Promise<void>;
  leave: () => Promise<void>;
  rematch: () => Promise<void>;
  submitGuess: (guessId: string) => Promise<void>;
}

export interface UseRoomResult {
  state: RoomUiState;
  /** 自身席位（1 = 房主；来自创建/加入响应，随 localStorage 持久化）。 */
  mySlot: 1 | 2;
  actions: RoomActions;
  /** 提交猜测错误（toast 展示）。 */
  guessError: string;
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
  const lastAppliedRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);

  const applyEvent = useCallback((event: Envelope) => {
    if (event.sequence <= lastAppliedRef.current) return; // 按 sequence 去重
    lastAppliedRef.current = event.sequence;
    setState((s) => ({ ...roomReducer(s, event), lastSequence: event.sequence }));
  }, []);

  useEffect(() => {
    if (!roomId) return; // 无成员资格：空 roomId 不发起请求，等页面重定向
    let disposed = false;
    let retry = 0;

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
        console.log("DEBUG-WS constructor threw");
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;
      ws.onopen = () => {
        console.log("DEBUG-WS open");
      
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
          setState((s) => ({ ...s, connection: "connected" }));
          // 快照对齐（room/members/match/round 权威视图 + 历史事件）；
          // 重放事件由服务端在 hello-ok 后推送，reducer 按 sequence 去重。
          api
            .roomSnapshot(roomId, token, 0)
            .then((snapshot) => {
              if (disposed) return;
              setState((s) => applySnapshot({ ...s, lastSequence: 0 }, snapshot));
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
      const delay = Math.min(1000 * 2 ** retry, 30000) * (0.8 + Math.random() * 0.4);
      retry += 1;
      window.setTimeout(() => connect(lastAppliedRef.current), delay);
    };

    // 先建连（hello → hello-ok → 重放），快照在 hello-ok 后拉取（自视角棋盘/权威状态）。
    // 实测：Chromium 在整页加载（含刷新）期间创建的 WS 握手会被延迟数十秒，
    // load 事件后创建瞬时完成——首次连接等页面加载完再发起。
    const start = () => {
      if (!disposed) connect(lastAppliedRef.current);
    };
    if (document.readyState === "loading") {
      window.addEventListener("load", start, { once: true });
    } else {
      start();
    }

    return () => {
      disposed = true;
      window.removeEventListener("load", start);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [roomId, token, applyEvent]);

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
        await api.leaveRoom(roomId, token);
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
      if (!state.round || state.round.status !== "playing" || !state.match) return;
      const idempotencyKey = crypto.randomUUID();
      try {
        const resp = await api.submitMultiGuess(
          roomId,
          token,
          state.match.roundIndex,
          guessId,
          idempotencyKey,
        );
        // 自视角无事件回放：本地追加（08 §10.2）
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
      } catch (e) {
        setGuessError(e instanceof Error ? e.message : "猜测失败。");
      }
    },
  };

  return { state, mySlot, actions, guessError };
}
