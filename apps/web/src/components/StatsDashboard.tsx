"use client";

import { useMemo, useRef, useState } from "react";
import { ConfigProvider, DatePicker } from "antd";
import zhCN from "antd/locale/zh_CN";
import dayjs, { type Dayjs } from "dayjs";
import "dayjs/locale/zh-cn";
import { useLiveQuery } from "dexie-react-hooks";
import type { EChartsCoreOption } from "echarts/core";
import {
  BarChart3,
  CalendarCheck2,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Target,
  Trash2,
  Trophy,
  Upload,
  X,
} from "lucide-react";
import { useEffect } from "react";
import { QUESTION_DIFFICULTY_LABELS } from "@touhouflandre/shared";
import {
  MULTIPLAYER_MODE_LABELS,
  ROOM_FORMAT_SHORT,
} from "../domain/multiRoom";
import {
  aggregateWorks,
  buildHistogram,
  dailyStreak,
  displayGuessesForRecord,
  filterStatsRecords,
  guessDurations,
  roundsForRecords,
  selfScore,
  summarize,
  winningGuessDistribution,
} from "../stats/aggregate";
import { clearStatistics, statsDb, subscribeStatsChanges } from "../stats/db";
import {
  applyStatsImport,
  createStatsExport,
  downloadStatsExport,
  parseStatsImport,
  previewStatsImport,
} from "../stats/transfer";
import type {
  MultiplayerStatsRecord,
  StatsExportFile,
  StatsDifficulty,
  StatsFilters,
  StatsOutcome,
  StatsRecord,
  StatsRound,
} from "../stats/types";
import { CharacterAvatar } from "./CharacterAvatar";
import { StatsChart } from "./StatsChart";

const MODE_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "daily", label: "每日" },
  { value: "random", label: "随机" },
  { value: "multiplayer", label: "多人" },
] as const;

const DIFFICULTY_OPTIONS: {
  value: StatsFilters["difficulty"];
  label: string;
}[] = [
  { value: "all", label: "全部难度" },
  { value: "easy", label: QUESTION_DIFFICULTY_LABELS.easy },
  { value: "normal", label: QUESTION_DIFFICULTY_LABELS.normal },
  { value: "hard", label: QUESTION_DIFFICULTY_LABELS.hard },
  { value: "lunatic", label: QUESTION_DIFFICULTY_LABELS.lunatic },
  { value: "custom", label: QUESTION_DIFFICULTY_LABELS.custom },
  { value: "unknown", label: "未知" },
];

dayjs.locale("zh-cn");

const OUTCOME_LABELS: Record<StatsOutcome, string> = {
  win: "成功",
  loss: "失败",
  draw: "平局",
  forfeit: "放弃",
  abandoned: "已重开",
  disconnect: "断线判负",
  incomplete: "同步不完整",
};

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function percent(value: number): string {
  return `${(value * 100).toFixed(value > 0 && value < 0.1 ? 1 : 0)}%`;
}

function difficultyLabel(value: StatsDifficulty): string {
  return value === "unknown" ? "未知" : QUESTION_DIFFICULTY_LABELS[value];
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}

export function StatsDashboard() {
  const [filters, setFilters] = useState<StatsFilters>({
    mode: "all",
    format: "all",
    multiplayerMode: "all",
    difficulty: "all",
  });
  const [revision, setRevision] = useState(0);
  const [clearOpen, setClearOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<{
    file: StatsExportFile;
    total: number;
    additions: number;
    replacements: number;
  } | null>(null);
  const [importError, setImportError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const records = useLiveQuery(
    () => statsDb.records.orderBy("startedAt").reverse().toArray(),
    [revision],
    [],
  );
  const incompleteDrafts = useLiveQuery(
    async () =>
      (
        await statsDb.drafts.where("kind").equals("multiplayer").toArray()
      ).filter((draft) => draft.kind === "multiplayer" && draft.incomplete)
        .length,
    [revision],
    0,
  );

  useEffect(
    () => subscribeStatsChanges(() => setRevision((value) => value + 1)),
    [],
  );

  const filtered = useMemo(
    () => filterStatsRecords(records, filters),
    [records, filters],
  );
  const metrics = useMemo(() => summarize(filtered), [filtered]);
  const works = useMemo(() => aggregateWorks(filtered), [filtered]);
  const guessDistribution = useMemo(
    () => winningGuessDistribution(filtered),
    [filtered],
  );
  const guessHistogram = useMemo(
    () => buildHistogram(guessDurations(filtered)),
    [filtered],
  );
  const roundHistogram = useMemo(
    () =>
      buildHistogram(
        roundsForRecords(filtered).map((round) => round.durationMs),
      ),
    [filtered],
  );
  const streak = useMemo(
    () =>
      dailyStreak(
        records,
        new Date(),
        filters.difficulty === "all" ? undefined : filters.difficulty,
      ),
    [filters.difficulty, records],
  );

  const workOption = useMemo<EChartsCoreOption>(
    () => ({
      animationDuration: 450,
      grid: {
        left: 48,
        right: 48,
        top: 48,
        bottom: works.length > 10 ? 72 : 42,
      },
      legend: { top: 4, data: ["答案出现", "获胜题局", "胜率"] },
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown) => {
          const list = params as { dataIndex: number }[];
          const item = works[list[0]?.dataIndex ?? 0];
          return item
            ? `<strong>${escapeHtml(item.code)} · ${escapeHtml(item.title)}</strong><br/>总题局：${item.total}<br/>获胜题局：${item.wins}<br/>胜率：${percent(item.winRate)}`
            : "";
        },
      },
      xAxis: {
        type: "category",
        data: works.map((item) => item.code),
        axisLabel: { interval: 0 },
      },
      yAxis: [
        { type: "value", minInterval: 1, name: "题局" },
        {
          type: "value",
          min: 0,
          max: 1,
          interval: 0.25,
          name: "胜率",
          axisLabel: { formatter: (value: number) => `${value * 100}%` },
        },
      ],
      dataZoom:
        works.length > 10
          ? [
              { type: "slider", start: 0, end: 100, height: 18, bottom: 10 },
              { type: "inside" },
            ]
          : [],
      series: [
        {
          name: "答案出现",
          type: "bar",
          data: works.map((item) => item.total),
          itemStyle: { color: "#9aa5a0" },
          barMaxWidth: 30,
        },
        {
          name: "获胜题局",
          type: "bar",
          data: works.map((item) => item.wins),
          barMaxWidth: 30,
        },
        {
          name: "胜率",
          type: "line",
          yAxisIndex: 1,
          data: works.map((item) => item.winRate),
          symbolSize: 7,
          smooth: 0.2,
        },
      ],
    }),
    [works],
  );

  const distributionOption = useMemo<EChartsCoreOption>(
    () => ({
      grid: { left: 42, right: 18, top: 28, bottom: 42 },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        name: "猜测次数",
        data: guessDistribution.map((item) => String(item.guesses)),
      },
      yAxis: { type: "value", minInterval: 1, name: "获胜题局" },
      series: [
        {
          type: "bar",
          name: "获胜题局",
          data: guessDistribution.map((item) => item.count),
          barMaxWidth: 34,
        },
      ],
    }),
    [guessDistribution],
  );

  const histogramOption = (
    bins: ReturnType<typeof buildHistogram>,
  ): EChartsCoreOption => ({
    grid: { left: 42, right: 16, top: 24, bottom: 48 },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "category",
      data: bins.map((bin) => bin.label),
      axisLabel: { rotate: bins.length > 6 ? 30 : 0 },
    },
    yAxis: { type: "value", minInterval: 1 },
    series: [
      { type: "bar", data: bins.map((bin) => bin.count), barMaxWidth: 34 },
    ],
  });

  const handleExport = async () =>
    downloadStatsExport(await createStatsExport());

  const handleImportFile = async (file?: File) => {
    if (!file) return;
    setImportError("");
    try {
      const parsed = parseStatsImport(await file.text());
      setImportPreview({
        file: parsed,
        ...(await previewStatsImport(parsed.records)),
      });
    } catch (error) {
      setImportError(
        error instanceof Error
          ? `无法读取统计文件：${error.message}`
          : "无法读取统计文件。",
      );
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const applyImport = async (mode: "merge" | "replace") => {
    if (!importPreview) return;
    if (
      mode === "replace" &&
      !window.confirm(
        "覆盖导入会先清除现有统计记录，当前游戏进度不受影响。确定继续吗？",
      )
    )
      return;
    await applyStatsImport(importPreview.file.records, mode);
    setImportPreview(null);
  };

  return (
    <main className="mx-auto w-full max-w-[1240px] px-[18px] pb-20 pt-8 max-[680px]:pb-24 max-[680px]:pt-5">
      <header className="flex flex-wrap items-end justify-between gap-5 border-b border-line pb-5">
        <div>
          <p className="mb-1 text-[0.72rem] font-bold uppercase text-vermilion">
            LOCAL STATS
          </p>
          <h1 className="font-brand text-[2.5rem] font-black text-ink max-[680px]:text-[2rem]">
            游玩统计
          </h1>
          <p className="mt-1 text-sm text-ink-soft">数据仅保存在此浏览器中。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept="application/json,.json"
            onChange={(event) => void handleImportFile(event.target.files?.[0])}
          />
          <ActionButton
            icon={Upload}
            label="导出"
            onClick={() => void handleExport()}
          />
          <ActionButton
            icon={Download}
            label="导入"
            onClick={() => fileInputRef.current?.click()}
          />
          <ActionButton
            icon={Trash2}
            label="清除数据"
            danger
            onClick={() => setClearOpen(true)}
          />
        </div>
      </header>

      <section
        className="flex flex-wrap items-start gap-4 border-b border-line py-4"
        aria-label="统计筛选"
      >
        <div className="grid gap-1.5">
          <span className="h-4 text-xs font-bold leading-4 text-ink-soft">
            模式
          </span>
          <div
            className="inline-flex h-10 rounded-[6px] border border-line bg-[var(--surface-soft)] p-1"
            role="group"
            aria-label="游戏模式"
          >
            {MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`min-w-14 rounded-[4px] px-3 py-1.5 text-xs font-bold ${filters.mode === option.value ? "bg-[var(--surface)] text-vermilion shadow-sm" : "text-ink-soft"}`}
                aria-pressed={filters.mode === option.value}
                onClick={() =>
                  setFilters((current) => ({
                    ...current,
                    mode: option.value,
                    format:
                      option.value === "daily" || option.value === "random"
                        ? "all"
                        : current.format,
                    multiplayerMode:
                      option.value === "daily" || option.value === "random"
                        ? "all"
                        : current.multiplayerMode,
                  }))
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <DateRangeFilter
          from={filters.from ?? ""}
          to={filters.to ?? ""}
          onFromChange={(from) =>
            setFilters((current) => ({ ...current, from: from || undefined }))
          }
          onToChange={(to) =>
            setFilters((current) => ({ ...current, to: to || undefined }))
          }
          onClear={() =>
            setFilters((current) => ({
              ...current,
              from: undefined,
              to: undefined,
            }))
          }
        />
        <label className="grid gap-1.5">
          <span className="h-4 text-xs font-bold leading-4 text-ink-soft">
            多人赛制
          </span>
          <select
            className="h-10 rounded-[5px] border border-line bg-[var(--surface)] px-3 text-sm text-ink"
            value={filters.format}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                format: event.target.value as StatsFilters["format"],
              }))
            }
          >
            <option value="all">全部赛制</option>
            <option value="bo1">BO1</option>
            <option value="bo3">BO3</option>
            <option value="bo5">BO5</option>
            <option value="bo7">BO7</option>
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="h-4 text-xs font-bold leading-4 text-ink-soft">
            多人玩法
          </span>
          <select
            className="h-10 rounded-[5px] border border-line bg-[var(--surface)] px-3 text-sm text-ink"
            value={filters.multiplayerMode}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                multiplayerMode: event.target
                  .value as StatsFilters["multiplayerMode"],
              }))
            }
          >
            <option value="all">全部玩法</option>
            <option value="race">竞速</option>
            <option value="relay">接力</option>
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="h-4 text-xs font-bold leading-4 text-ink-soft">
            游戏难度
          </span>
          <select
            className="h-10 rounded-[5px] border border-line bg-[var(--surface)] px-3 text-sm text-ink"
            value={filters.difficulty}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                difficulty: event.target.value as StatsFilters["difficulty"],
              }))
            }
          >
            {DIFFICULTY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      {importError ? (
        <p
          className="mt-4 rounded-[5px] border border-[var(--error-border)] bg-[var(--error-bg)] px-4 py-3 text-sm text-[var(--error-text)]"
          role="alert"
        >
          {importError}
        </p>
      ) : null}
      {incompleteDrafts ? (
        <p
          className="mt-4 rounded-[5px] border border-[var(--amber-border)] bg-amber-soft px-4 py-3 text-sm text-[var(--amber-strong)]"
          role="status"
        >
          有 {incompleteDrafts}{" "}
          场多人对局已超过服务器保留期，无法恢复完整终态，未计入胜率与图表。
        </p>
      ) : null}

      <section
        className="grid grid-cols-4 gap-3 py-5 max-[900px]:grid-cols-2 max-[520px]:grid-cols-1"
        aria-label="总体指标"
      >
        <Metric
          icon={BarChart3}
          label="总游玩"
          value={String(metrics.plays)}
          detail={`${metrics.losses} 负 · ${metrics.draws} 平`}
        />
        <Metric
          icon={Trophy}
          label="成功次数"
          value={String(metrics.wins)}
          detail={`胜率 ${percent(metrics.winRate)}`}
          tone="jade"
        />
        <Metric
          icon={Clock3}
          label="题局用时"
          value={formatDuration(metrics.medianMs)}
          detail={`平均 ${formatDuration(metrics.averageMs)} · P90 ${formatDuration(metrics.p90Ms)}`}
        />
        <Metric
          icon={CalendarCheck2}
          label="每日连胜"
          value={String(streak.current)}
          detail={`历史最长 ${streak.longest} 天`}
          tone="amber"
        />
      </section>

      <ChartSection
        title="作品猜测情况"
        description="灰柱为答案出现题局，主题色柱为获胜题局，折线为作品胜率。"
      >
        {works.length ? (
          <StatsChart
            option={workOption}
            ariaLabel="各东方作品答案出现次数、获胜次数与胜率"
            className="h-[390px]"
          />
        ) : (
          <EmptyChart />
        )}
      </ChartSection>

      <div className="mt-4 grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-4 max-[900px]:grid-cols-1">
        <ChartSection title="获胜猜测次数" description="只统计成功题局。">
          {guessDistribution.length ? (
            <StatsChart
              option={distributionOption}
              ariaLabel="获胜题局猜测次数分布"
            />
          ) : (
            <EmptyChart />
          )}
        </ChartSection>
        <ChartSection
          title="耗时分布"
          description="有效前台时间，不含页面后台停留与请求等待。"
        >
          <div className="grid grid-cols-2 gap-2 max-[680px]:grid-cols-1">
            <MiniHistogram
              title="单次猜测"
              bins={guessHistogram}
              option={histogramOption(guessHistogram)}
            />
            <MiniHistogram
              title="整局游戏"
              bins={roundHistogram}
              option={histogramOption(roundHistogram)}
            />
          </div>
        </ChartSection>
      </div>

      <History records={filtered} />

      {clearOpen ? (
        <ConfirmDialog
          title="清除全部统计数据？"
          text="完成记录和进行中的统计草稿将被删除，当前单人或多人游戏进度不会被清除。"
          confirmLabel="确认清除"
          onCancel={() => setClearOpen(false)}
          onConfirm={async () => {
            await clearStatistics();
            setClearOpen(false);
          }}
        />
      ) : null}
      {importPreview ? (
        <ImportDialog
          preview={importPreview}
          onClose={() => setImportPreview(null)}
          onApply={applyImport}
        />
      ) : null}
    </main>
  );
}

function ActionButton({
  icon: Icon,
  label,
  danger = false,
  onClick,
}: {
  icon: typeof Download;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`inline-flex h-9 items-center gap-2 rounded-[5px] border px-3 text-xs font-bold ${danger ? "border-[var(--error-border)] text-[var(--error-text)] hover:bg-[var(--error-bg)]" : "border-line text-ink hover:border-line-strong hover:bg-[var(--surface-soft)]"}`}
      onClick={onClick}
    >
      <Icon size={16} aria-hidden="true" />
      {label}
    </button>
  );
}

function DateRangeFilter({
  from,
  to,
  onFromChange,
  onToChange,
  onClear,
}: {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onClear: () => void;
}) {
  const fromDate = from ? dayjs(from, "YYYY-MM-DD") : null;
  const toDate = to ? dayjs(to, "YYYY-MM-DD") : null;

  return (
    <div className="grid w-[420px] max-w-full gap-1.5 max-[680px]:w-full">
      <span className="h-4 text-xs font-bold leading-4 text-ink-soft">
        日期范围
      </span>
      <ConfigProvider
        locale={zhCN}
        theme={{
          token: {
            borderRadius: 5,
            colorBgContainer: "var(--surface)",
            colorBorder: "var(--line)",
            colorPrimary: "var(--vermilion)",
            colorPrimaryBg: "var(--accent-soft)",
            colorPrimaryBgHover: "var(--accent-soft)",
            colorPrimaryBorder: "var(--accent-hover-border)",
            colorPrimaryHover: "var(--vermilion-dark)",
            colorText: "var(--ink)",
            colorTextHeading: "var(--ink)",
            colorTextLightSolid: "var(--accent-contrast)",
            colorTextQuaternary: "var(--subtle-text)",
            colorTextSecondary: "var(--ink-soft)",
            colorBgElevated: "var(--surface)",
            colorFillSecondary: "var(--surface-soft)",
            colorFillTertiary: "var(--surface-muted)",
            colorSplit: "var(--line)",
            colorTextPlaceholder: "var(--placeholder-text)",
            controlItemBgActive: "var(--accent-soft)",
            controlItemBgHover: "var(--surface-soft)",
            fontFamily: "var(--font-ui)",
          },
        }}
      >
        <div className="stats-date-range flex h-10 min-w-0 items-center overflow-hidden rounded-[6px] border border-line bg-[var(--surface)] px-2 shadow-sm transition focus-within:border-vermilion focus-within:ring-2 focus-within:ring-[var(--accent-soft)]">
          <CalendarRange
            className="mx-1 shrink-0 text-vermilion"
            size={16}
            aria-hidden="true"
          />
          <DatePicker
            className="stats-date-picker"
            value={fromDate}
            format="YYYY-MM-DD"
            placeholder="开始日期"
            inputReadOnly
            allowClear={false}
            aria-label="开始日期"
            disabledDate={(current) =>
              Boolean(toDate && current.isAfter(toDate, "day"))
            }
            onChange={(value) => onFromChange(datePickerValue(value))}
          />
          <span
            className="mx-1 h-px w-5 shrink-0 bg-line-strong max-[420px]:w-3"
            aria-hidden="true"
          />
          <DatePicker
            className="stats-date-picker"
            value={toDate}
            format="YYYY-MM-DD"
            placeholder="结束日期"
            inputReadOnly
            allowClear={false}
            aria-label="结束日期"
            disabledDate={(current) =>
              Boolean(fromDate && current.isBefore(fromDate, "day"))
            }
            onChange={(value) => onToChange(datePickerValue(value))}
          />
          {from || to ? (
            <button
              type="button"
              className="ml-1 inline-flex size-8 shrink-0 items-center justify-center rounded-[4px] text-ink-soft hover:bg-[var(--surface-soft)] hover:text-ink"
              aria-label="清除日期筛选"
              title="清除日期筛选"
              onClick={onClear}
            >
              <X size={15} />
            </button>
          ) : (
            <span className="w-2 shrink-0" />
          )}
        </div>
      </ConfigProvider>
    </div>
  );
}

function datePickerValue(value: Dayjs | null): string {
  return value?.format("YYYY-MM-DD") ?? "";
}

function Metric({
  icon: Icon,
  label,
  value,
  detail,
  tone = "accent",
}: {
  icon: typeof Target;
  label: string;
  value: string;
  detail: string;
  tone?: "accent" | "jade" | "amber";
}) {
  const toneClass =
    tone === "jade"
      ? "text-jade bg-jade-soft"
      : tone === "amber"
        ? "text-amber bg-amber-soft"
        : "text-vermilion bg-vermilion-soft";
  return (
    <article className="flex min-h-[112px] items-start gap-3 rounded-[7px] border border-line bg-[var(--surface)] p-4 shadow-sm">
      <span
        className={`inline-flex size-9 shrink-0 items-center justify-center rounded-[5px] ${toneClass}`}
      >
        <Icon size={19} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-bold text-ink-soft">{label}</p>
        <strong className="mt-1 block text-2xl text-ink">{value}</strong>
        <small className="mt-1 block text-xs text-ink-soft">{detail}</small>
      </div>
    </article>
  );
}

function ChartSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[7px] border border-line bg-[var(--surface)] p-4 shadow-sm">
      <div className="mb-2">
        <h2 className="text-base font-black text-ink">{title}</h2>
        <p className="mt-0.5 text-xs text-ink-soft">{description}</p>
      </div>
      {children}
    </section>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-[280px] items-center justify-center text-sm text-ink-soft">
      暂无符合筛选条件的数据
    </div>
  );
}

function MiniHistogram({
  title,
  bins,
  option,
}: {
  title: string;
  bins: ReturnType<typeof buildHistogram>;
  option: EChartsCoreOption;
}) {
  return (
    <div className="min-w-0">
      <h3 className="px-2 pt-2 text-center text-xs font-bold text-ink-soft">
        {title}
      </h3>
      {bins.length ? (
        <StatsChart
          option={option}
          ariaLabel={`${title}耗时直方图`}
          className="h-[280px]"
        />
      ) : (
        <div className="flex h-[280px] items-center justify-center text-xs text-ink-soft">
          暂无数据
        </div>
      )}
    </div>
  );
}

function History({ records }: { records: StatsRecord[] }) {
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [records, pageSize]);
  const pageCount = Math.max(1, Math.ceil(records.length / pageSize));
  const visible = records.slice((page - 1) * pageSize, page * pageSize);
  return (
    <section className="mt-5 border-t border-line pt-5">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-ink">游玩记录</h2>
          <p className="text-xs text-ink-soft">
            共 {records.length} 条本地记录
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-bold text-ink-soft">
          每页
          <select
            className="h-8 rounded-[5px] border border-line bg-[var(--surface)] px-2 text-ink"
            value={pageSize}
            onChange={(event) => setPageSize(Number(event.target.value))}
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
          条
        </label>
      </div>
      <div className="overflow-x-auto rounded-[7px] border border-line bg-[var(--surface)]">
        <table className="w-full min-w-[980px] border-collapse text-left text-sm">
          <thead className="bg-[var(--surface-soft)] text-xs text-ink-soft">
            <tr>
              <th className="px-4 py-3">开始时间</th>
              <th className="px-4 py-3">模式</th>
              <th className="px-4 py-3">难度</th>
              <th className="px-4 py-3">结果</th>
              <th className="px-4 py-3">猜测次数</th>
              <th className="px-4 py-3">总耗时</th>
              <th className="px-4 py-3">所猜角色</th>
              <th className="px-4 py-3">答案</th>
              <th className="w-12 px-3 py-3">
                <span className="sr-only">详情</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.length ? (
              visible.map((record) => (
                <HistoryRow key={record.id} record={record} />
              ))
            ) : (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-14 text-center text-ink-soft"
                >
                  暂无游玩记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 text-xs text-ink-soft">
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center rounded-[5px] border border-line disabled:opacity-40"
          title="上一页"
          aria-label="上一页"
          disabled={page <= 1}
          onClick={() => setPage((value) => value - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <span className="min-w-16 text-center">
          {page} / {pageCount}
        </span>
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center rounded-[5px] border border-line disabled:opacity-40"
          title="下一页"
          aria-label="下一页"
          disabled={page >= pageCount}
          onClick={() => setPage((value) => value + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </section>
  );
}

function HistoryRow({ record }: { record: StatsRecord }) {
  const [open, setOpen] = useState(false);
  const rounds = record.kind === "single" ? [record.round] : record.rounds;
  const displayGuesses = displayGuessesForRecord(record);
  const guessCount = displayGuesses.length;
  const modeLabel =
    record.kind === "multiplayer"
      ? MULTIPLAYER_MODE_LABELS[record.multiplayerMode ?? "race"]
      : "";
  const rosterLabel =
    record.kind === "multiplayer" && (record.rosterSize ?? 2) > 2
      ? ` · ${record.rosterSize} 人/${record.playerLimit ?? record.rosterSize}`
      : "";
  return (
    <>
      <tr className="border-t border-line align-middle">
        <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-soft">
          {formatDateTime(record.startedAt)}
        </td>
        <td className="px-4 py-3 font-bold text-ink">
          {record.kind === "single"
            ? record.mode === "daily"
              ? "每日"
              : "随机"
            : `${modeLabel} · ${ROOM_FORMAT_SHORT[record.format]} · ${selfScore(record)}${rosterLabel}`}
        </td>
        <td className="px-4 py-3 text-xs font-bold text-ink-soft">
          {difficultyLabel(record.difficulty ?? "unknown")}
        </td>
        <td className="px-4 py-3">
          <Outcome outcome={record.outcome} />
        </td>
        <td className="px-4 py-3 tabular-nums text-ink">{guessCount}</td>
        <td className="px-4 py-3 tabular-nums text-ink">
          {formatDuration(record.durationMs)}
        </td>
        <td className="px-4 py-2">
          <GuessSequence guesses={displayGuesses} />
        </td>
        <td className="px-4 py-2">
          <AnswerSequence rounds={rounds} />
        </td>
        <td className="px-3 py-2">
          {record.kind === "multiplayer" ? (
            <button
              type="button"
              className="inline-flex size-8 items-center justify-center rounded-[5px] text-ink-soft hover:bg-[var(--surface-soft)]"
              title={open ? "收起详情" : "展开详情"}
              aria-label={open ? "收起详情" : "展开详情"}
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              <ChevronRight
                className={`transition-transform ${open ? "rotate-90" : ""}`}
                size={17}
              />
            </button>
          ) : null}
        </td>
      </tr>
      {open && record.kind === "multiplayer" ? (
        <tr className="border-t border-line bg-[var(--surface-soft)]">
          <td colSpan={9} className="px-4 py-3">
            <RoundDetails record={record} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Outcome({ outcome }: { outcome: StatsOutcome }) {
  const style =
    outcome === "win"
      ? "bg-jade-soft text-jade"
      : "border border-[var(--error-border)] bg-[var(--error-bg)] text-[var(--error-text)]";
  return (
    <span
      className={`inline-flex rounded-[4px] px-2 py-1 text-xs font-bold ${style}`}
    >
      {OUTCOME_LABELS[outcome]}
    </span>
  );
}

function GuessSequence({
  guesses,
}: {
  guesses: ReturnType<typeof displayGuessesForRecord>;
}) {
  if (!guesses.length)
    return <span className="text-xs text-ink-soft">未猜测</span>;
  return (
    <div
      className="flex w-max min-w-max items-center gap-1 py-1"
      aria-label={`猜测角色：${guesses.map((guess) => guess.name).join("、")}`}
    >
      {guesses.slice(0, 9).map((guess, index) => (
        <CharacterAvatar
          key={`${guess.id}-${index}`}
          avatarUrl={guess.avatarUrl}
          name={guess.name}
          initials={guess.name.slice(0, 2)}
          loading="eager"
          className="size-8 shrink-0"
        />
      ))}
      {guesses.length > 9 ? (
        <span className="ml-1 shrink-0 text-xs font-bold text-ink-soft">
          +{guesses.length - 9}
        </span>
      ) : null}
    </div>
  );
}

function AnswerSequence({ rounds }: { rounds: StatsRound[] }) {
  return (
    <div
      className="flex w-max min-w-max items-center gap-1 py-1"
      aria-label={`答案角色：${rounds.map((round) => round.answer.name).join("、")}`}
    >
      {rounds.map((round) => (
        <CharacterAvatar
          key={round.roundIndex}
          avatarUrl={round.answer.avatarUrl}
          name={round.answer.name}
          initials={round.answer.name.slice(0, 2)}
          loading="eager"
          className="size-8 shrink-0"
        />
      ))}
    </div>
  );
}

function RoundDetails({ record }: { record: MultiplayerStatsRecord }) {
  return (
    <div className="grid gap-2">
      {record.rounds.map((round) => (
        <div
          key={round.roundIndex}
          className="grid grid-cols-[72px_64px_80px_minmax(0,1fr)] items-center gap-3 text-xs max-[680px]:grid-cols-[60px_54px_minmax(0,1fr)]"
        >
          <strong className="text-ink">第 {round.roundIndex} 局</strong>
          <span
            className={
              round.result === "win" ? "text-jade" : "text-[var(--error-text)]"
            }
          >
            {round.result === "win"
              ? "胜"
              : round.result === "loss"
                ? "负"
                : "平"}
          </span>
          <span className="tabular-nums text-ink-soft max-[680px]:hidden">
            {formatDuration(round.durationMs)}
          </span>
          <div className="flex min-w-0 items-center gap-2">
            <CharacterAvatar
              avatarUrl={round.answer.avatarUrl}
              name={round.answer.name}
              initials={round.answer.name.slice(0, 2)}
              loading="eager"
              className="size-7"
            />
            <span className="truncate text-ink">
              答案：{round.answer.name} · {round.answer.work?.code ?? "TH--"}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ConfirmDialog({
  title,
  text,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  text: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4"
      role="presentation"
    >
      <section
        className="w-full max-w-[430px] rounded-[7px] border border-line bg-[var(--surface)] p-5 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="confirm-title" className="text-lg font-black text-ink">
              {title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-ink-soft">{text}</p>
          </div>
          <button
            type="button"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-[5px] text-ink-soft hover:bg-[var(--surface-soft)]"
            title="关闭"
            aria-label="关闭"
            onClick={onCancel}
          >
            <X size={18} />
          </button>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="h-9 rounded-[5px] border border-line px-4 text-sm font-bold text-ink"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="h-9 rounded-[5px] bg-vermilion px-4 text-sm font-bold text-[var(--accent-contrast)]"
            onClick={() => void onConfirm()}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function ImportDialog({
  preview,
  onClose,
  onApply,
}: {
  preview: { total: number; additions: number; replacements: number };
  onClose: () => void;
  onApply: (mode: "merge" | "replace") => void | Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
      <section
        className="w-full max-w-[460px] rounded-[7px] border border-line bg-[var(--surface)] p-5 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 id="import-title" className="text-lg font-black text-ink">
              导入统计数据
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              已校验 {preview.total} 条记录
            </p>
          </div>
          <button
            type="button"
            className="inline-flex size-8 items-center justify-center rounded-[5px] text-ink-soft"
            aria-label="关闭"
            title="关闭"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-[5px] bg-jade-soft p-3">
            <dt className="text-xs font-bold text-jade">新增</dt>
            <dd className="mt-1 text-xl font-black text-ink">
              {preview.additions}
            </dd>
          </div>
          <div className="rounded-[5px] bg-amber-soft p-3">
            <dt className="text-xs font-bold text-amber">同 ID 更新</dt>
            <dd className="mt-1 text-xl font-black text-ink">
              {preview.replacements}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs leading-5 text-ink-soft">
          合并会保留其他现有记录；覆盖会清空现有统计后导入，并再次要求确认。
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="h-9 rounded-[5px] border border-line px-4 text-sm font-bold text-ink"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="h-9 rounded-[5px] border border-vermilion px-4 text-sm font-bold text-vermilion"
            onClick={() => void onApply("replace")}
          >
            覆盖导入
          </button>
          <button
            type="button"
            className="h-9 rounded-[5px] bg-jade px-4 text-sm font-bold text-white"
            onClick={() => void onApply("merge")}
          >
            合并导入
          </button>
        </div>
      </section>
    </div>
  );
}
