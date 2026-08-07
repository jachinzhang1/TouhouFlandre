// 局结果弹窗：查看对局本地关闭；下一局倒计时由服务端 startsAt 驱动展示。
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { RoundEndedPayload } from "@touhouflandre/shared";
import { RoundResultOverlay } from "./RoundResultOverlay";

// fake 时钟 2026-08-06T12:00:00Z；下一局 4 秒后 → 12:00:04Z
const RESULT: RoundEndedPayload = {
  matchIndex: 0,
  roundIndex: 1,
  result: "win",
  winnerSlot: 1,
  answer: { id: "reimu_hakurei", name: "博丽灵梦", avatarUrl: "/c.png" },
  boards: { slot1: [], slot2: [] },
  scores: { slot1: 1, slot2: 0 },
  nextStartsAt: "2026-08-06T12:00:04Z",
};

describe("RoundResultOverlay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("展示胜负与答案", () => {
    render(<RoundResultOverlay result={RESULT} mySlot={1} nextRoundStartsAt={RESULT.nextStartsAt ?? null} />);
    expect(screen.getByText(/本局获胜/)).toBeTruthy();
    expect(screen.getByText("博丽灵梦")).toBeTruthy();
  });

  it("点击查看对局本地关闭弹窗", () => {
    render(<RoundResultOverlay result={RESULT} mySlot={1} nextRoundStartsAt={RESULT.nextStartsAt ?? null} />);
    fireEvent.click(screen.getByRole("button", { name: "查看对局" }));
    expect(screen.queryByText(/本局获胜/)).toBeNull();
  });

  it("显示下一局倒计时（服务端 startsAt 驱动）", () => {
    render(<RoundResultOverlay result={RESULT} mySlot={1} nextRoundStartsAt={RESULT.nextStartsAt ?? null} />);
    expect(screen.getByText(/下一局 4 秒后开始/)).toBeTruthy();
  });

  it("无下一局（对局结束）不显示倒计时", () => {
    render(<RoundResultOverlay result={{ ...RESULT, nextStartsAt: undefined }} mySlot={1} nextRoundStartsAt={null} />);
    expect(screen.queryByText(/下一局/)).toBeNull();
  });
});
