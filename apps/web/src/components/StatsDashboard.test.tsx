import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { statsDb } from "../stats/db";
import {
  STATS_SCHEMA_VERSION,
  type MultiplayerStatsRecord,
  type SingleStatsRecord,
} from "../stats/types";
import { StatsDashboard } from "./StatsDashboard";

const { statsChartCalls } = vi.hoisted(() => ({
  statsChartCalls: [] as {
    ariaLabel: string;
    option: unknown;
    className?: string;
  }[],
}));

vi.mock("./StatsChart", () => ({
  StatsChart: (props: {
    ariaLabel: string;
    option: unknown;
    className?: string;
  }) => {
    statsChartCalls.push(props);
    return <div role="img" aria-label={props.ariaLabel} />;
  },
}));

vi.mock("antd", () => ({
  ConfigProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  DatePicker: ({
    className,
    placeholder,
    value,
    onChange,
    ...props
  }: {
    className?: string;
    placeholder?: string;
    value?: { format: (template: string) => string } | null;
    onChange?: (value: { format: (template: string) => string } | null) => void;
    [key: string]: unknown;
  }) => (
    <input
      aria-label={props["aria-label"] as string}
      className={`ant-picker ${className ?? ""}`}
      placeholder={placeholder}
      value={value?.format("YYYY-MM-DD") ?? ""}
      onChange={(event) =>
        onChange?.(
          event.target.value ? { format: () => event.target.value } : null,
        )
      }
    />
  ),
}));

const record: SingleStatsRecord = {
  id: "record-1",
  schemaVersion: STATS_SCHEMA_VERSION,
  kind: "single",
  mode: "daily",
  puzzleKey: "2026-08-07",
  startedAt: "2026-08-07T10:20:30Z",
  endedAt: "2026-08-07T10:21:00Z",
  durationMs: 30_000,
  outcome: "win",
  round: {
    roundIndex: 1,
    startedAt: "2026-08-07T10:20:30Z",
    endedAt: "2026-08-07T10:21:00Z",
    durationMs: 30_000,
    result: "win",
    answer: {
      id: "reimu",
      name: "博丽灵梦",
      avatarUrl: "/avatars/reimu.webp",
      work: { id: "th01", title: "东方灵异传", code: "TH01" },
    },
    guesses: [
      {
        id: "reimu",
        name: "博丽灵梦",
        avatarUrl: "/avatars/reimu.webp",
        correct: true,
        durationMs: 30_000,
      },
    ],
  },
};

const placementRecord: MultiplayerStatsRecord = {
  id: "placement-record",
  schemaVersion: STATS_SCHEMA_VERSION,
  kind: "multiplayer",
  mode: "multiplayer",
  format: "bo3",
  multiplayerMode: "race",
  ruleSetKey: "placement",
  ruleSetVersion: 1,
  matchIndex: 1,
  startedAt: "2026-08-08T10:20:30Z",
  endedAt: "2026-08-08T10:23:00Z",
  durationMs: 150_000,
  outcome: "draw",
  reason: "normal",
  scoreSelf: 6,
  opponentScores: [6, 3, 0],
  rosterSize: 4,
  playerLimit: 6,
  scoringMode: "placement",
  finalRank: 1,
  tiedForFirst: true,
  eliminatedRound: 2,
  rounds: [
    {
      ...record.round,
      roundIndex: 1,
      pointsAwarded: 3,
      participationStatus: "correct",
    },
  ],
};

const pointsRecord: MultiplayerStatsRecord = {
  ...placementRecord,
  id: "points-record",
  endedAt: "2026-08-08T10:25:00Z",
  durationMs: 180_000,
  scoreSelf: 4,
  opponentScores: [4, 2, 1],
  scoringMode: "points",
  finalRank: 2,
  tiedForFirst: false,
  eliminatedRound: undefined,
  rounds: [
    {
      ...record.round,
      roundIndex: 1,
      pointsAwarded: 2,
      participationStatus: "timed_out",
    },
  ],
};

function makeWorkRecord(index: number): SingleStatsRecord {
  const code = `TH${String(index).padStart(2, "0")}`;
  const day = String(index).padStart(2, "0");
  const name = `角色 ${index}`;
  const avatarUrl = `/avatars/character-${index}.webp`;
  return {
    ...record,
    id: `record-${index}`,
    puzzleKey: `2026-08-${day}`,
    startedAt: `2026-08-${day}T10:20:30Z`,
    endedAt: `2026-08-${day}T10:21:00Z`,
    round: {
      ...record.round,
      roundIndex: index,
      startedAt: `2026-08-${day}T10:20:30Z`,
      endedAt: `2026-08-${day}T10:21:00Z`,
      answer: {
        id: `answer-${index}`,
        name,
        avatarUrl,
        work: { id: `th${index}`, title: `作品 ${index}`, code },
      },
      guesses: [
        {
          id: `guess-${index}`,
          name,
          avatarUrl,
          correct: true,
          durationMs: 30_000,
        },
      ],
    },
  };
}

describe("StatsDashboard", () => {
  beforeEach(async () => {
    statsChartCalls.length = 0;
    await statsDb.records.clear();
    await statsDb.drafts.clear();
    await statsDb.metadata.clear();
    await statsDb.records.put(record);
  });

  it("展示指标、图表与精确到秒的记录", async () => {
    render(<StatsDashboard />);
    await waitFor(() =>
      expect(screen.getByLabelText(/猜测角色：博丽灵梦/)).toBeTruthy(),
    );
    expect(screen.getByText("成功次数")).toBeTruthy();
    expect(
      screen.getByRole("img", {
        name: "各东方作品答案出现次数、获胜次数与胜率",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText((text) => /\d{2}:\d{2}:\d{2}/.test(text)),
    ).toBeTruthy();
  });

  it("作品猜测情况默认展示完整横轴范围", async () => {
    await statsDb.records.bulkPut(
      Array.from({ length: 11 }, (_, index) => makeWorkRecord(index + 2)),
    );
    render(<StatsDashboard />);

    await screen.findByRole("img", {
      name: "各东方作品答案出现次数、获胜次数与胜率",
    });
    await waitFor(() => {
      const workCharts = statsChartCalls.filter(
        (call) => call.ariaLabel === "各东方作品答案出现次数、获胜次数与胜率",
      );
      expect(workCharts.length).toBeGreaterThan(0);
      const option = workCharts[workCharts.length - 1]?.option as {
        dataZoom?: Array<Record<string, unknown>>;
      };
      expect(option.dataZoom?.[0]).toMatchObject({
        type: "slider",
        start: 0,
        end: 100,
      });
      expect(option.dataZoom?.[0]).not.toHaveProperty("startValue");
      expect(option.dataZoom?.[0]).not.toHaveProperty("endValue");
    });
  });

  it("游玩记录头像使用非懒加载策略", async () => {
    const { container } = render(<StatsDashboard />);
    await screen.findByLabelText(/猜测角色：博丽灵梦/);

    const avatars = Array.from(container.querySelectorAll("img"));
    expect(avatars.length).toBeGreaterThan(0);
    expect(
      avatars.every((avatar) => avatar.getAttribute("loading") === "eager"),
    ).toBe(true);
  });

  it("使用正确的导入导出图标，并联动 Ant Design 日期筛选", async () => {
    render(<StatsDashboard />);
    await screen.findByLabelText(/猜测角色：博丽灵梦/);

    expect(
      screen
        .getByRole("button", { name: "导出" })
        .querySelector(".lucide-upload"),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "导入" })
        .querySelector(".lucide-download"),
    ).toBeTruthy();

    const from = screen.getByLabelText("开始日期");
    const to = screen.getByLabelText("结束日期");
    expect(from.closest(".stats-date-picker")).toBeTruthy();
    expect(to.closest(".stats-date-picker")).toBeTruthy();
    expect(from.closest(".stats-date-range")?.className).toContain("h-10");
    expect(screen.queryByText("开始")).toBeNull();
    expect(screen.queryByText("结束")).toBeNull();

    fireEvent.change(from, { target: { value: "2026-08-01" } });
    fireEvent.change(to, { target: { value: "2026-08-07" } });
    expect((from as HTMLInputElement).value).toBe("2026-08-01");
    expect((to as HTMLInputElement).value).toBe("2026-08-07");
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

  it("展示积分淘汰最终名次、淘汰局和逐局积分", async () => {
    await statsDb.records.put(placementRecord);
    render(<StatsDashboard />);

    expect(
      await screen.findByText(/竞速 · 积分淘汰 · 6 分 · 并列第 1 名/),
    ).toBeTruthy();
    expect(screen.getByText(/第 2 局淘汰/)).toBeTruthy();
    const row = screen.getByText(/竞速 · 积分淘汰/).closest("tr");
    const detailsButton = row?.querySelector<HTMLButtonElement>(
      'button[aria-label="展开详情"]',
    );
    expect(detailsButton).toBeTruthy();
    fireEvent.click(detailsButton!);
    expect(screen.getByText("+3 分 · 猜中")).toBeTruthy();
  });

  it("展示积分累计最终名次和逐局积分", async () => {
    await statsDb.records.put(pointsRecord);
    render(<StatsDashboard />);

    expect(
      await screen.findByText(/竞速 · 积分累计 · 4 分 · 第 2 名/),
    ).toBeTruthy();
    expect(screen.queryByText(/第 2 局淘汰/)).toBeNull();
    const row = screen.getByText(/竞速 · 积分累计/).closest("tr");
    const detailsButton = row?.querySelector<HTMLButtonElement>(
      'button[aria-label="展开详情"]',
    );
    expect(detailsButton).toBeTruthy();
    fireEvent.click(detailsButton!);
    expect(screen.getByText("+2 分 · 超时")).toBeTruthy();
  });

  it("清除数据要求确认且不直接误触执行", async () => {
    render(<StatsDashboard />);
    await screen.findByLabelText(/猜测角色：博丽灵梦/);
    await userEvent.click(screen.getByRole("button", { name: "清除数据" }));
    expect(await statsDb.records.count()).toBe(1);
    expect(
      screen.getByRole("dialog", { name: "清除全部统计数据？" }),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "确认清除" }));
    await waitFor(async () => expect(await statsDb.records.count()).toBe(0));
  });
});
