import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { statsDb } from "../stats/db";
import { STATS_SCHEMA_VERSION, type SingleStatsRecord } from "../stats/types";
import { StatsDashboard } from "./StatsDashboard";

vi.mock("./StatsChart", () => ({
  StatsChart: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} />,
}));

const record: SingleStatsRecord = {
  id: "record-1", schemaVersion: STATS_SCHEMA_VERSION, kind: "single", mode: "daily", puzzleKey: "2026-08-07",
  startedAt: "2026-08-07T10:20:30Z", endedAt: "2026-08-07T10:21:00Z", durationMs: 30_000, outcome: "win",
  round: {
    roundIndex: 1, startedAt: "2026-08-07T10:20:30Z", endedAt: "2026-08-07T10:21:00Z", durationMs: 30_000,
    result: "win", answer: { id: "reimu", name: "博丽灵梦", work: { id: "th01", title: "东方灵异传", code: "TH01" } },
    guesses: [{ id: "reimu", name: "博丽灵梦", correct: true, durationMs: 30_000 }],
  },
};

describe("StatsDashboard", () => {
  beforeEach(async () => {
    await statsDb.records.clear();
    await statsDb.drafts.clear();
    await statsDb.metadata.clear();
    await statsDb.records.put(record);
  });

  it("展示指标、图表与精确到秒的记录", async () => {
    render(<StatsDashboard />);
    await waitFor(() => expect(screen.getByLabelText(/猜测角色：博丽灵梦/)).toBeTruthy());
    expect(screen.getByText("成功次数")).toBeTruthy();
    expect(screen.getByRole("img", { name: "各东方作品答案出现次数、获胜次数与胜率" })).toBeTruthy();
    expect(
      screen.getByText((text) => /\d{2}:\d{2}:\d{2}/.test(text)),
    ).toBeTruthy();
  });

  it("使用正确的导入导出图标，并联动日期范围", async () => {
    render(<StatsDashboard />);
    await screen.findByLabelText(/猜测角色：博丽灵梦/);

    expect(screen.getByRole("button", { name: "导出" }).querySelector(".lucide-upload")).toBeTruthy();
    expect(screen.getByRole("button", { name: "导入" }).querySelector(".lucide-download")).toBeTruthy();

    const from = screen.getByLabelText("开始日期");
    const to = screen.getByLabelText("结束日期");
    fireEvent.change(from, { target: { value: "2026-08-01" } });
    fireEvent.change(to, { target: { value: "2026-08-07" } });
    expect(to.getAttribute("min")).toBe("2026-08-01");
    expect(from.getAttribute("max")).toBe("2026-08-07");
    await userEvent.click(screen.getByRole("button", { name: "清除日期筛选" }));
    expect((from as HTMLInputElement).value).toBe("");
    expect((to as HTMLInputElement).value).toBe("");
  });

  it("固定非成功结果配色并横向排列猜测头像", async () => {
    const lossRecord: SingleStatsRecord = {
      ...record,
      id: "record-loss",
      startedAt: "2026-08-07T11:20:30Z",
      endedAt: "2026-08-07T11:21:00Z",
      outcome: "loss",
      round: { ...record.round, result: "loss" },
    };
    await statsDb.records.put(lossRecord);
    render(<StatsDashboard />);

    const failure = await screen.findByText("失败");
    expect(failure.className).toContain("bg-[var(--error-bg)]");
    expect(failure.className).toContain("text-[var(--error-text)]");
    const sequence = screen.getAllByLabelText(/猜测角色：博丽灵梦/)[0];
    expect(sequence.className).toContain("gap-1");
    expect(sequence.querySelector("[class*='-ml-']")).toBeNull();
  });

  it("清除数据要求确认且不直接误触执行", async () => {
    render(<StatsDashboard />);
    await screen.findByLabelText(/猜测角色：博丽灵梦/);
    await userEvent.click(screen.getByRole("button", { name: "清除数据" }));
    expect(await statsDb.records.count()).toBe(1);
    expect(screen.getByRole("dialog", { name: "清除全部统计数据？" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "确认清除" }));
    await waitFor(async () => expect(await statsDb.records.count()).toBe(0));
  });
});
