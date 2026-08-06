// 多人房间持久化与展示工具（08 §10.1）。
import type { MultiRoomFormat } from "@touhoufriberg/shared";

export const MULTI_ROOM_STORAGE_KEY = "touhoufriberg:multi-room";

export interface StoredMultiRoom {
  roomId: string;
  roomCode: string;
  guestToken: string;
  /** 自身席位（1 = 房主；结果展示/离开判断用）。 */
  memberSlot: 1 | 2;
}

export function saveMultiRoom(room: StoredMultiRoom): void {
  window.localStorage.setItem(MULTI_ROOM_STORAGE_KEY, JSON.stringify(room));
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
      return {
        ...(parsed as StoredMultiRoom),
        memberSlot: slot === 2 ? 2 : 1, // 兼容旧存储：缺省视为房主
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
