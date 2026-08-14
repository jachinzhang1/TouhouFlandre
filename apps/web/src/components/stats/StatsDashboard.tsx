"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { EChartsCoreOption } from "echarts/core";
import {
  BarChart3,
  CalendarCheck2,
  Clock3,
  Target,
  Trophy,
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
} from "../../stats/aggregate";
import {
  clearStatistics,
  statsDb,
  subscribeStatsChanges,
} from "../../stats/db";
import {
  applyStatsImport,
  createStatsExport,
  downloadStatsExport,
  parseStatsImport,
  previewStatsImport,
} from "../../stats/transfer";
import type { StatsExportFile, StatsFilters } from "../../stats/types";
import { StatsChart } from "./StatsChart";
import { ConfirmStatsClearDialog, StatsImportDialog } from "./StatsDataDialogs";
import { StatsFilterBar } from "./StatsFilterBar";
import { StatsHistory } from "./StatsHistory";
import { StatsPageActions } from "./StatsPageActions";
import { Paper } from "../Paper";
import { PageHeader } from "../layout/PageHeader";

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
          itemStyle: { opacity: 0.34 },
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

  const handleImportFile = async (file: File) => {
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
    <main className="stats-page">
      <PageHeader
        description="你的数据仅保存在此浏览器中。"
        rightSlot={
          <StatsPageActions
            onClear={() => setClearOpen(true)}
            onExport={handleExport}
            onImport={handleImportFile}
          />
        }
        title="游玩统计"
      />

      <StatsFilterBar filters={filters} onChange={setFilters} />

      {importError ? (
        <StatsNotice role="alert" tone="error">
          {importError}
        </StatsNotice>
      ) : null}
      {incompleteDrafts ? (
        <StatsNotice role="status" tone="warning">
          有 {incompleteDrafts}{" "}
          场多人对局已超过服务器保留期，无法恢复完整终态，未计入胜率与图表。
        </StatsNotice>
      ) : null}

      <section className="stats-metric-grid" aria-label="总体指标">
        <Metric
          icon={BarChart3}
          label="总游玩"
          primary={`${metrics.plays}局`}
          secondary={`${metrics.losses}负 / ${metrics.draws}平`}
          stackOrder={4}
        />
        <Metric
          icon={Trophy}
          label="成功次数"
          primary={`${metrics.wins}次`}
          secondary={`胜率 ${percent(metrics.winRate)}`}
          stackOrder={3}
          tone="jade"
        />
        <Metric
          icon={Clock3}
          label="题局用时"
          primary={formatDuration(metrics.medianMs)}
          secondary={[
            `平均 ${formatDuration(metrics.averageMs)}`,
            `P90 ${formatDuration(metrics.p90Ms)}`,
          ]}
          stackOrder={2}
        />
        <Metric
          icon={CalendarCheck2}
          label="每日连胜"
          primary={`${streak.current}连胜`}
          secondary={["历史最长", `${streak.longest}天连胜`]}
          stackOrder={1}
          tone="amber"
        />
      </section>

      <ChartSection title="作品猜测情况" stackOrder={3}>
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

      <div className="stats-chart-grid">
        <ChartSection
          title="获胜猜测次数"
          description="只统计成功题局。"
          stackOrder={2}
        >
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
          stackOrder={1}
        >
          <div className="stats-histogram-grid">
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

function StatsNotice({
  children,
  role,
  tone,
}: {
  children: React.ReactNode;
  role: "alert" | "status";
  tone: "error" | "warning";
}) {
  return (
    <Paper
      animateOnMount={false}
      as="div"
      className={`stats-notice stats-notice-${tone}`}
      foldSize={10}
      role={role}
      sticker={false}
      unfoldOnHover={false}
    >
      {children}
    </Paper>
  );
}

function Metric({
  icon: Icon,
  label,
  primary,
  secondary,
  stackOrder,
  tone = "accent",
}: {
  icon: typeof Target;
  label: string;
  primary: string;
  secondary: string | string[];
  stackOrder: number;
  tone?: "accent" | "jade" | "amber";
}) {
  const secondaryLines = Array.isArray(secondary) ? secondary : [secondary];

  return (
    <Paper
      animateOnMount={false}
      as="article"
      className={`stats-metric-card stats-metric-${tone}`}
      foldSize={14}
      stackOrder={stackOrder}
    >
      <span className="stats-metric-icon">
        <Icon size={24} aria-hidden="true" />
      </span>
      <div className="stats-metric-copy">
        <p>{label}</p>
        <div className="stats-metric-data-row">
          <strong>{primary}</strong>
          <span
            className="stats-metric-secondary"
            data-multiline={secondaryLines.length > 1 ? "true" : "false"}
          >
            {secondaryLines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </span>
        </div>
      </div>
    </Paper>
  );
}

function ChartSection({
  title,
  description,
  children,
  stackOrder,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  stackOrder: number;
}) {
  return (
    <Paper
      animateOnMount={false}
      as="article"
      className="stats-chart-paper"
      foldSize={18}
      stackOrder={stackOrder}
    >
      <div className="stats-chart-heading">
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {children}
    </Paper>
  );
}

function EmptyChart() {
  return <div className="stats-empty-chart">暂无符合筛选条件的数据</div>;
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
    <div className="stats-mini-histogram">
      <h3>{title}</h3>
      {bins.length ? (
        <StatsChart
          option={option}
          ariaLabel={`${title}耗时直方图`}
          className="h-[280px]"
        />
      ) : (
        <div className="stats-mini-empty">暂无数据</div>
      )}
    </div>
  );
}
