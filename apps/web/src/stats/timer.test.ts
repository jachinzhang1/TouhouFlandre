import { afterEach, describe, expect, it, vi } from "vitest";
import { ForegroundTimer } from "./timer";

describe("ForegroundTimer", () => {
  afterEach(() => vi.useRealTimers());

  it("页面隐藏期间暂停累计", () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    const timer = new ForegroundTimer();
    timer.setActive(true);
    vi.advanceTimersByTime(1200);
    expect(timer.snapshot()).toBe(1200);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(5000);
    expect(timer.snapshot()).toBe(1200);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(800);
    expect(timer.snapshot()).toBe(2000);
    timer.destroy();
  });
});

