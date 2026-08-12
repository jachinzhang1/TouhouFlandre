"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { EChartsCoreOption } from "echarts/core";
import {
  BarChart3,
  CalendarCheck2,
  Clock3,
  Download,
  Target,
  Trash2,
  Trophy,
  Upload,
} from "lucide-react";
import {
  aggregateWorks,
  buildHistogram,
  dailyStreak,
  filterStatsRecords,
  guessDurations,
  roundsForRecords,
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
import type { StatsExportFile, StatsFilters } from "../stats/types";
import { StatsChart } from "./StatsChart";
import {
  ConfirmStatsClearDialog,
  StatsImportDialog,
} from "./stats/StatsDataDialogs";
import { StatsFilterBar } from "./stats/StatsFilterBar";
import { StatsHistory } from "./stats/StatsHistory";

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(value > 0 && value < 0.1 ? 1 : 0)}%`;
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

      <StatsFilterBar filters={filters} onChange={setFilters} />

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

      <StatsHistory records={filtered} />

      {clearOpen ? (
        <ConfirmStatsClearDialog
          onCancel={() => setClearOpen(false)}
          onConfirm={async () => {
            await clearStatistics();
            setClearOpen(false);
          }}
        />
      ) : null}
      {importPreview ? (
        <StatsImportDialog
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
