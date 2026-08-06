// 多人模式 WebSocket 协议类型。
// 与 contracts/ws/protocol.yaml 字段一一对应（手写维护）；
// 字段名集合由 scripts/check-ws-protocol.mjs 与协议比对（`task check:ws-protocol`）。
// 依据：docs/08_multiplayer_mode_design.md §8（WebSocket 协议）。

import type { FeedbackStatus, GuessResult } from "./types";

export const MULTI_ROOM_FORMATS = ["bo1", "bo3", "bo5", "bo7"] as const;
export type MultiRoomFormat = (typeof MULTI_ROOM_FORMATS)[number];

export const MULTI_ROOM_STATUSES = ["lobby", "playing", "finished", "closed"] as const;
export type MultiRoomStatus = (typeof MULTI_ROOM_STATUSES)[number];

export const MULTI_MEMBER_STATUSES = ["connected", "disconnected", "left"] as const;
export type MultiMemberStatus = (typeof MULTI_MEMBER_STATUSES)[number];

export const MULTI_ROUND_STATUSES = ["countdown", "playing", "ended"] as const;
export type MultiRoundStatus = (typeof MULTI_ROUND_STATUSES)[number];

export const MULTI_MATCH_RESULTS = ["win", "loss", "draw"] as const;
export type MultiMatchResult = (typeof MULTI_MATCH_RESULTS)[number];

export const MULTI_MATCH_END_REASONS = ["normal", "forfeit", "disconnect", "server_restart", "round_cap"] as const;
export type MultiMatchEndReason = (typeof MULTI_MATCH_END_REASONS)[number];

export const MULTI_ROOM_CLOSE_REASONS = ["host_left", "member_left", "ttl", "retention"] as const;
export type MultiRoomCloseReason = (typeof MULTI_ROOM_CLOSE_REASONS)[number];

// 事件信封（08 §8.2）：sequence 房间内单调递增，客户端按 sequence 去重排序、缺口拉快照补齐。
export interface Envelope {
  type: string;
  eventId: string;
  roomId: string;
  sequence: number;
  occurredAt: string;
  payload: Record<string, unknown>;
}

// ---------- 事件 payload（08 §8.3 事件表） ----------

export interface MemberView {
  slot: number;
  displayName: string;
  status: MultiMemberStatus;
  ready: boolean;
}

export interface RoomUpdatedPayload {
  format: MultiRoomFormat;
  members: MemberView[];
}

export interface MatchStartedPayload {
  format: MultiRoomFormat;
  targetWins: number;
  catalogVersion: string;
  matchIndex: number;
}

export interface MatchRematchPayload {
  memberSlot: number;
}

export interface RoundStartedPayload {
  matchIndex: number;
  roundIndex: number;
  startsAt: string;
  deadline: string;
  maxGuesses: number;
}

export interface RoundPlayingPayload {
  matchIndex: number;
  roundIndex: number;
}

export interface RoundOpponentGuessPayload {
  matchIndex: number;
  roundIndex: number;
  rowIndex: number;
  statuses: FeedbackStatus[];
}

export interface RoundEndedPayload {
  matchIndex: number;
  roundIndex: number;
  result: MultiMatchResult;
  winnerSlot: number | null;
  answer: { id: string; name: string; avatarUrl: string };
  boards: { slot1: GuessResult[]; slot2: GuessResult[] };
  scores: { slot1: number; slot2: number };
}

export interface MatchEndedPayload {
  matchIndex: number;
  result: MultiMatchResult;
  winnerSlot: number | null;
  scores: { slot1: number; slot2: number };
  reason: MultiMatchEndReason;
}

export interface RoomClosedPayload {
  reason: MultiRoomCloseReason;
}

// ---------- 服务端控制帧（非事件，无 sequence） ----------

export interface HelloOkMessage {
  type: "hello-ok";
  roomId: string;
  nextSequence: number;
}

export interface ReplacedMessage {
  type: "replaced";
  reason: "replaced";
}

// ---------- 客户端消息（仅两类，均为平铺消息） ----------

export interface HelloMessage {
  type: "hello";
  token: string;
  lastSequence: number;
}

export interface AckMessage {
  type: "ack";
  lastSequence: number;
}

// 事件类型集合（08 §8.3 全表；round.opponent.guess 是唯一逐观察者事件）。
export const MULTI_WS_EVENT_TYPES = [
  "room.updated",
  "match.started",
  "match.rematch",
  "round.started",
  "round.playing",
  "round.opponent.guess",
  "round.ended",
  "match.ended",
  "room.closed",
] as const;
export type MultiWsEventType = (typeof MULTI_WS_EVENT_TYPES)[number];
