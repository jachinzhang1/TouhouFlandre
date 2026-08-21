import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { statsDb } from "../../stats/db";
import {
  STATS_SCHEMA_VERSION,
  type MultiplayerStatsRecord,
  type SingleStatsRecord,
} from "../../stats/types";
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

const multiplayerRecord: MultiplayerStatsRecord = {
  id: "record-multiplayer",
  schemaVersion: STATS_SCHEMA_VERSION,
  kind: "multiplayer",
  mode: "multiplayer",
  difficulty: "normal",
  format: "bo1",
  multiplayerMode: "race",
  matchIndex: 0,
  startedAt: "2026-08-08T10:20:30Z",
  endedAt: "2026-08-08T10:21:00Z",
  durationMs: 30_000,
  outcome: "win",
  reason: "normal",
  scoreSelf: 1,
  opponentScores: [0],
  rosterSize: 2,
  playerLimit: 2,
  scoringMode: "wins",
  rounds: [record.round],
};

const placementRecord: MultiplayerStatsRecord = {
  ...multiplayerRecord,
  id: "record-placement",
  scoreSelf: 6,
  opponentScores: [4, 2, 0],
  rosterSize: 4,
  playerLimit: 6,
  scoringMode: "placement",
  finalRank: 1,
  tiedForFirst: true,
  eliminatedRound: 2,
  rounds: [
    {
      ...record.round,
      pointsAwarded: 3,
      participationStatus: "correct",
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
    const { container } = render(<StatsDashboard />);
    await waitFor(() =>
      expect(screen.getByLabelText(/猜测角色：博丽灵梦/)).toBeTruthy(),
    );
    expect(screen.getByText("成功次数")).toBeTruthy();
    const metricGrid = container.querySelector(
      ".stats-metric-grid",
    ) as HTMLElement;
    expect(metricGrid.textContent).toContain("1局");
    expect(metricGrid.textContent).toContain("0负 / 0平");
    expect(metricGrid.textContent).toContain("1次");
    expect(metricGrid.textContent).toContain("胜率 100%");
    expect(metricGrid.textContent).toContain("平均 00:30");
    expect(metricGrid.textContent).toContain("P90 00:30");
    expect(metricGrid.querySelector("small")).toBeNull();
    expect(metricGrid.querySelector(".stats-metric-comma")).toBeNull();
    expect(metricGrid.textContent).toContain("历史最长");
    expect(metricGrid.textContent).toContain("1天连胜");
    const multilineMetrics = metricGrid.querySelectorAll(
      '.stats-metric-secondary[data-multiline="true"]',
    );
    expect(multilineMetrics).toHaveLength(2);
    expect(
      [...multilineMetrics].every((metric) => metric.children.length === 2),
    ).toBe(true);
    expect(
      screen.getByRole("img", {
        name: "各东方作品答案出现次数、获胜次数与胜率",
      }),
    ).toBeTruthy();
    expect(
      screen.queryByText(
        "灰柱为答案出现题局，主题色柱为获胜题局，折线为作品胜率。",
      ),
    ).toBeNull();
    const historyTable = screen.getByRole("table", { name: "游玩记录" });
    expect(historyTable.dataset.paperResponsiveStacked).toBe("true");
    const historyPaper = historyTable.closest(
      ".stats-history-paper",
    ) as HTMLElement;
    expect(historyPaper.classList.contains("paper-data-table")).toBe(true);
    expect(historyPaper.dataset.paperFolded).toBe("false");
    expect(historyPaper.closest(".paper-sticker")).toBeNull();
    const historySticky = container.querySelector(".stats-history-sticky");
    const historyHeading = screen.getByRole("heading", { name: "游玩记录" });
    const historyHeader = screen.getByRole("table", {
      name: "游玩记录表头",
    });
    expect(historySticky?.contains(historyHeading)).toBe(true);
    expect(historySticky?.contains(historyHeader)).toBe(true);
    expect(screen.getByText("共 1 条本地记录。")).toBeTruthy();
    const pageSizePicker = screen.getByLabelText("每页记录数");
    const pageSizeControl = pageSizePicker.closest(
      ".paper-picker-control",
    ) as HTMLElement;
    expect(pageSizeControl).toBeTruthy();
    expect(pageSizeControl.dataset.paperVariant).toBe("plain");
    expect(pageSizePicker.closest(".paper-select-control")).toBeNull();
    const historyHeadingControls = pageSizeControl.closest(
      ".stats-history-heading-controls",
    ) as HTMLElement;
    const pager = screen.getByRole("group", { name: "记录翻页" });
    expect(pager.classList.contains("paper-segment-group")).toBe(true);
    expect(pager.querySelectorAll(".paper-segment-separator")).toHaveLength(2);
    expect(historySticky?.contains(pager)).toBe(true);
    expect(historyHeadingControls.children[0]).toBe(
      pageSizeControl.closest(".stats-history-page-size"),
    );
    expect(historyHeadingControls.children[1]).toBe(pager);
    const previousPage = screen.getByRole("button", { name: "上一页" });
    const nextPage = screen.getByRole("button", { name: "下一页" });
    expect(previousPage.className).not.toContain("paper-button-filled");
    expect(previousPage.dataset.paperVariant).toBe("plain");
    expect(previousPage.dataset.paperFolded).toBe("false");
    expect(previousPage.className).not.toContain("paper-button-compact");
    const previousIcon = previousPage.querySelector(".lucide-chevron-left");
    expect(previousIcon).toBeTruthy();
    expect(previousIcon?.getAttribute("width")).toBe("20");
    expect(nextPage.className).not.toContain("paper-button-filled");
    expect(nextPage.dataset.paperVariant).toBe("plain");
    expect(nextPage.dataset.paperFolded).toBe("false");
    const nextIcon = nextPage.querySelector(".lucide-chevron-right");
    expect(nextIcon).toBeTruthy();
    expect(nextIcon?.getAttribute("width")).toBe("20");
    const pageCounter = pager.querySelector(
      ".paper-pagination-counter",
    ) as HTMLElement;
    expect(pageCounter.dataset.paperVariant).toBe("plain");
    expect(pageCounter.textContent).toContain("1 / 1");
    expect(within(historyHeader).getAllByRole("columnheader")).toHaveLength(8);
    const historyRow = within(historyTable).getByRole("row");
    expect(within(historyRow).getAllByRole("cell")).toHaveLength(8);
    const successCell = within(historyRow)
      .getByText("成功")
      .closest(".stats-history-outcome-success") as HTMLElement;
    expect(successCell).toBeTruthy();
    expect(successCell.classList.contains("paper-tinted-cell")).toBe(true);
    expect(
      within(historyRow).queryByRole("button", { name: /局详情/ }),
    ).toBeNull();
    expect(within(historyRow).queryByText("详情")).toBeNull();
    const headerScroll = container.querySelector(
      ".stats-history-table-header-scroll",
    ) as HTMLElement;
    historyTable.scrollLeft = 120;
    fireEvent.scroll(historyTable);
    expect(headerScroll.scrollLeft).toBe(120);
    headerScroll.scrollLeft = 48;
    fireEvent.scroll(headerScroll);
    expect(historyTable.scrollLeft).toBe(48);
    expect(
      screen.getByText((text) => /\d{2}:\d{2}:\d{2}/.test(text)),
    ).toBeTruthy();
  });

  it("在模式列持续显示详情控制并展开多人局记录", async () => {
    await statsDb.records.clear();
    await statsDb.records.put(multiplayerRecord);
    render(<StatsDashboard />);

    const details = await screen.findByRole("button", { name: "查看局详情" });
    expect(details.getAttribute("aria-expanded")).toBe("false");
    expect(details.textContent).toContain("详情");
    expect(details.className).not.toContain("paper-button-compact");
    expect(details.closest(".stats-history-mode")).toBeTruthy();
    await userEvent.click(details);
    const firstRound = await screen.findByText("第 1 局");
    expect(firstRound.closest(".paper-data-table-detail")).toBeTruthy();
    expect(screen.getByRole("button", { name: "收起局详情" })).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "收起局详情" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("展示积分制名次、人数和逐局得分", async () => {
    await statsDb.records.clear();
    await statsDb.records.put(placementRecord);
    render(<StatsDashboard />);

    expect(
      await screen.findByText(
        /竞速 · 积分制 · 6 分 · 并列第 1 名 · 第 2 局淘汰 · 4 人\/6/,
      ),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "查看局详情" }));
    expect(await screen.findByText("+3 分 · 猜中")).toBeTruthy();
  });

  it("在表头上方使用标准分组按钮翻页", async () => {
    await statsDb.records.bulkPut(
      Array.from({ length: 10 }, (_, index) => makeWorkRecord(index + 2)),
    );
    render(<StatsDashboard />);

    const next = await screen.findByRole("button", { name: "下一页" });
    expect(await screen.findByText("1 / 2")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "上一页" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect((next as HTMLButtonElement).disabled).toBe(false);
    expect(
      screen.getByRole("button", { name: "上一页" }).dataset.paperVariant,
    ).toBe("plain");
    expect(next.dataset.paperVariant).toBe("tinted");
    expect(
      screen.getByRole("button", { name: "上一页" }).dataset.paperFolded,
    ).toBe("false");
    expect(next.dataset.paperFolded).toBe("false");
    await userEvent.click(next);
    expect(await screen.findByText("2 / 2")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "下一页" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "上一页" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(
      screen.getByRole("button", { name: "下一页" }).dataset.paperVariant,
    ).toBe("plain");
    expect(
      screen.getByRole("button", { name: "上一页" }).dataset.paperVariant,
    ).toBe("tinted");
    expect(
      screen.getByRole("button", { name: "下一页" }).dataset.paperFolded,
    ).toBe("false");
    expect(
      screen.getByRole("button", { name: "上一页" }).dataset.paperFolded,
    ).toBe("false");
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
        series?: Array<{
          itemStyle?: { color?: string; opacity?: number };
        }>;
      };
      expect(option.dataZoom?.[0]).toMatchObject({
        type: "slider",
        start: 0,
        end: 100,
      });
      expect(option.dataZoom?.[0]).not.toHaveProperty("startValue");
      expect(option.dataZoom?.[0]).not.toHaveProperty("endValue");
      expect(option.series?.[0]?.itemStyle).toEqual({ opacity: 0.34 });
      expect(option.series?.[0]?.itemStyle).not.toHaveProperty("color");
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
        .querySelector(".lucide-download"),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "导入" })
        .querySelector(".lucide-upload"),
    ).toBeTruthy();

    const formatPicker = screen.getByRole("combobox", { name: "多人赛制" });
    const modePicker = screen.getByRole("combobox", { name: "多人玩法" });
    const difficultyPicker = screen.getByRole("combobox", {
      name: "游戏难度",
    });
    expect(formatPicker.querySelectorAll("hr")).toHaveLength(1);
    expect(modePicker.querySelectorAll("hr")).toHaveLength(1);
    expect(difficultyPicker.querySelectorAll("hr")).toHaveLength(2);
    expect(
      formatPicker
        .closest(".paper-surface")
        ?.getAttribute("data-paper-variant"),
    ).toBe("plain");
    fireEvent.click(screen.getByRole("button", { name: "每日" }));
    expect((formatPicker as HTMLSelectElement).disabled).toBe(true);
    expect((modePicker as HTMLSelectElement).disabled).toBe(true);

    const from = screen.getByLabelText("开始日期");
    const to = screen.getByLabelText("结束日期");
    expect(from.closest(".paper-date-picker")).toBeTruthy();
    expect(to.closest(".paper-date-picker")).toBeTruthy();
    const fromPaper = from.closest(".stats-date-paper-button") as HTMLElement;
    const toPaper = to.closest(".stats-date-paper-button") as HTMLElement;
    const clearDate = screen.getByRole("button", { name: "清除日期筛选" });
    expect(fromPaper.dataset.paperVariant).toBe("plain");
    expect(fromPaper.dataset.paperFolded).toBe("false");
    expect(toPaper.dataset.paperVariant).toBe("plain");
    expect(clearDate.getAttribute("aria-disabled")).toBe("true");
    expect((clearDate as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector(".stats-date-icon")).toBeNull();
    expect(
      document.querySelectorAll(".stats-date-range > .paper-segment-separator"),
    ).toHaveLength(1);
    expect(document.querySelector(".stats-date-connector")).toBeTruthy();

    fireEvent.change(from, { target: { value: "2026-08-01" } });
    fireEvent.change(to, { target: { value: "2026-08-07" } });
    expect((from as HTMLInputElement).value).toBe("2026-08-01");
    expect((to as HTMLInputElement).value).toBe("2026-08-07");
    expect(fromPaper.dataset.paperVariant).toBe("plain");
    expect(fromPaper.dataset.paperFolded).toBe("false");
    expect(toPaper.dataset.paperVariant).toBe("plain");
    expect(toPaper.dataset.paperFolded).toBe("false");
    expect(clearDate.getAttribute("aria-disabled")).toBeNull();
    await userEvent.click(clearDate);
    expect((from as HTMLInputElement).value).toBe("");
    expect((to as HTMLInputElement).value).toBe("");
  });

  it("直接为非成功结果单元格着色并横向排列猜测头像", async () => {
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
    expect(failure.className).toBe("stats-outcome");
    const failureCell = failure.closest(
      ".stats-history-outcome-cell",
    ) as HTMLElement;
    expect(
      failureCell.classList.contains("stats-history-outcome-failure"),
    ).toBe(true);
    expect(
      failureCell.classList.contains("stats-history-outcome-success"),
    ).toBe(false);
    expect(failureCell.classList.contains("paper-tinted-cell")).toBe(true);
    const drawRecord: SingleStatsRecord = {
      ...record,
      id: "record-draw",
      startedAt: "2026-08-07T12:20:30Z",
      endedAt: "2026-08-07T12:21:00Z",
      outcome: "draw",
      round: { ...record.round, result: "draw" },
    };
    await act(() => statsDb.records.put(drawRecord));
    const draw = await screen.findByText("平局");
    expect(
      draw
        .closest(".stats-history-outcome-cell")
        ?.classList.contains("stats-history-outcome-draw"),
    ).toBe(true);
    const sequence = screen.getAllByLabelText(/猜测角色：博丽灵梦/)[0];
    expect(sequence.className).toContain("gap-1");
    expect(sequence.querySelector("[class*='-ml-']")).toBeNull();
  });

  it("清除数据要求确认且不直接误触执行", async () => {
    render(<StatsDashboard />);
    await screen.findByLabelText(/猜测角色：博丽灵梦/);
    expect(
      screen
        .getByRole("button", { name: "清除数据" })
        .classList.contains("page-header-action-danger"),
    ).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "清除数据" }));
    expect(await statsDb.records.count()).toBe(1);
    expect(
      screen.getByRole("dialog", { name: "清除全部统计数据？" }),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "确认清除" }));
    await waitFor(async () => expect(await statsDb.records.count()).toBe(0));
  });
});
