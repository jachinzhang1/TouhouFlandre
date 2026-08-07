// 房间号/昵称表单校验（08 §4.1/§5.2）：归一化、合法字符集、昵称长度。
import { describe, expect, it } from "vitest";
import {
  isValidRoomCode,
  normalizeRoomCode,
} from "../domain/multiRoom";

describe("normalizeRoomCode", () => {
  it("去空格/连字符并转大写", () => {
    expect(normalizeRoomCode("abc-234")).toBe("ABC234");
    expect(normalizeRoomCode(" ab c 234 ")).toBe("ABC234");
    expect(normalizeRoomCode("AB-C2-34")).toBe("ABC234");
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
