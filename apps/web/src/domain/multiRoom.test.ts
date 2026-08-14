// 房间号/昵称表单校验（08 §4.1/§5.2）：归一化、合法字符集、昵称长度。
import { describe, expect, it } from "vitest";
import {
  countRelaySkips,
  isValidRoomCode,
  normalizeRoomCode,
  relaySkipRemaining,
  loadMultiRoom,
  saveMultiRoom,
  MULTI_ROOM_STORAGE_KEY,
} from "../domain/multiRoom";

describe("normalizeRoomCode", () => {
  it("去空格/连字符并转大写", () => {
    expect(normalizeRoomCode("abc-234")).toBe("ABC234");
    expect(normalizeRoomCode(" ab c 234 ")).toBe("ABC234");
    expect(normalizeRoomCode("AB-C2-34")).toBe("ABC234");
  });
});

describe("multiplayer credential storage", () => {
  it("reads legacy slots but no longer persists them", () => {
    localStorage.setItem(
      MULTI_ROOM_STORAGE_KEY,
      JSON.stringify({
        roomId: "room",
        roomCode: "ABC234",
        guestToken: "token",
        role: "player",
        memberSlot: 2,
      }),
    );
    expect(loadMultiRoom()?.memberSlot).toBe(2);
    saveMultiRoom({
      roomId: "room",
      roomCode: "ABC234",
      guestToken: "token",
      role: "player",
      memberId: "member",
    });
    expect(
      JSON.parse(localStorage.getItem(MULTI_ROOM_STORAGE_KEY) ?? "{}"),
    ).toEqual({
      roomId: "room",
      roomCode: "ABC234",
      guestToken: "token",
      role: "player",
      memberId: "member",
    });
  });
});

describe("isValidRoomCode", () => {
  it("6 位 32 字符集（去除 0/O/1/I）", () => {
    expect(isValidRoomCode("ABC234")).toBe(true);
    expect(isValidRoomCode("ZZZZZZ")).toBe(true);
    expect(isValidRoomCode("ABC23")).toBe(false); // 长度不足
    expect(isValidRoomCode("ABC2345")).toBe(false); // 超长
    expect(isValidRoomCode("ABO234")).toBe(false); // 含 O
    expect(isValidRoomCode("ABI234")).toBe(false); // 含 I
    expect(isValidRoomCode("AB0234")).toBe(false); // 含 0
    expect(isValidRoomCode("AB1234")).toBe(false); // 含 1
    expect(isValidRoomCode("ab2345")).toBe(false); // 小写（未归一化）
  });
});

describe("relay skip quota", () => {
  it("主动空过与超时空过按成员共享计数", () => {
    const rows = [
      { seat: 1, kind: "pass" },
      { seat: 1, kind: "timeout" },
      { seat: 1, kind: "guess" },
      { seat: 2, kind: "timeout" },
    ];

    expect(countRelaySkips(rows, 1)).toBe(2);
    expect(countRelaySkips(rows, 2)).toBe(1);
    expect(relaySkipRemaining(rows, 1, 2)).toBe(0);
    expect(relaySkipRemaining(rows, 2, 2)).toBe(1);
  });
});
