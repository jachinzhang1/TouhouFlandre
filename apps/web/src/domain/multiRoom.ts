// 多人房间持久化与展示工具（08 §10.1）。
import type {
  MultiParticipantRole,
  MultiRoomFormat,
  MultiplayerMode,
} from "@touhouflandre/shared";

export const MULTI_ROOM_STORAGE_KEY = "touhouflandre:multi-room";

export interface StoredMultiRoom {
  roomId: string;
  roomCode: string;
  guestToken: string;
  role: MultiParticipantRole;
  /** 自身席位（1 = 房主；结果展示/离开判断用）。 */
  memberId?: string;
  memberSlot?: 1 | 2;
}

export function saveMultiRoom(room: StoredMultiRoom): void {
  const { memberSlot: _legacySlot, ...authoritative } = room;
  window.localStorage.setItem(
    MULTI_ROOM_STORAGE_KEY,
    JSON.stringify(authoritative),
  );
}

export function loadMultiRoom(): StoredMultiRoom | null {
  try {
    const raw = window.localStorage.getItem(MULTI_ROOM_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as StoredMultiRoom).roomId === "string" &&
      typeof (parsed as StoredMultiRoom).roomCode === "string" &&
      typeof (parsed as StoredMultiRoom).guestToken === "string"
    ) {
      const slot = (parsed as StoredMultiRoom).memberSlot;
      const role =
        (parsed as StoredMultiRoom).role === "spectator"
          ? "spectator"
          : "player";
      const loaded: StoredMultiRoom = {
        ...(parsed as StoredMultiRoom),
        role,
        memberId:
          typeof (parsed as StoredMultiRoom).memberId === "string"
            ? (parsed as StoredMultiRoom).memberId
            : undefined,
      };
      return {
        ...loaded,
        memberSlot:
          role === "player" && (slot === 1 || slot === 2) ? slot : undefined,
      };
    }
  } catch {
    // 损坏的存储忽略，走重定向重建
  }
  return null;
}

export function clearMultiRoom(): void {
  window.localStorage.removeItem(MULTI_ROOM_STORAGE_KEY);
}

/** 房间号输入归一化（08 §4.1）：去空格/连字符、转大写。 */
export function normalizeRoomCode(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

/** 房间号合法：6 位 32 字符集（不含 0/O/1/I）。 */
export function isValidRoomCode(code: string): boolean {
  return /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code);
}

export const ROOM_FORMAT_LABELS: Record<MultiRoomFormat, string> = {
  bo1: "BO1 · 一局定胜负",
  bo3: "BO3 · 三局两胜",
  bo5: "BO5 · 五局三胜",
  bo7: "BO7 · 七局四胜",
};

export const ROOM_FORMAT_SHORT: Record<MultiRoomFormat, string> = {
  bo1: "BO1",
  bo3: "BO3",
  bo5: "BO5",
  bo7: "BO7",
};

export const MULTIPLAYER_MODE_LABELS: Record<MultiplayerMode, string> = {
  race: "竞速",
  relay: "接力",
};

export const MULTIPLAYER_MODE_DESCRIPTIONS: Record<MultiplayerMode, string> = {
  race: "两边同时猜，先猜中者赢下本局。",
  relay: "共用一栏轮流猜，猜中者赢下本局。",
};

export const TURN_SECONDS_OPTIONS = [30, 60, 90, 120] as const;
export type RelayTurnSeconds = (typeof TURN_SECONDS_OPTIONS)[number];

type RelaySkipRow = {
  seat: number;
  kind: string;
};

export function countRelaySkips(
  rows: readonly RelaySkipRow[],
  slot: 1 | 2,
): number {
  return rows.filter(
    (row) =>
      row.seat === slot && (row.kind === "timeout" || row.kind === "pass"),
  ).length;
}

export function relaySkipRemaining(
  rows: readonly RelaySkipRow[],
  slot: 1 | 2,
  maxSkipsPerPlayer: number,
): number {
  return Math.max(0, maxSkipsPerPlayer - countRelaySkips(rows, slot));
}
