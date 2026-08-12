"use client";

import { ConfigProvider, DatePicker } from "antd";
import zhCN from "antd/locale/zh_CN";
import dayjs, { type Dayjs } from "dayjs";
import "dayjs/locale/zh-cn";
import { CalendarRange, X } from "lucide-react";
import { QUESTION_DIFFICULTY_LABELS } from "@touhouflandre/shared";
import type { StatsFilters } from "../../stats/types";

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

interface StatsFilterBarProps {
  filters: StatsFilters;
  onChange: (filters: StatsFilters) => void;
}

export function StatsFilterBar({ filters, onChange }: StatsFilterBarProps) {
  const update = (patch: Partial<StatsFilters>) =>
    onChange({ ...filters, ...patch });

  return (
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
              className={`min-w-14 rounded-[4px] px-3 py-1.5 text-xs font-bold ${
                filters.mode === option.value
                  ? "bg-[var(--surface)] text-vermilion shadow-sm"
                  : "text-ink-soft"
              }`}
              aria-pressed={filters.mode === option.value}
              onClick={() =>
                update({
                  mode: option.value,
                  format:
                    option.value === "daily" || option.value === "random"
                      ? "all"
                      : filters.format,
                  multiplayerMode:
                    option.value === "daily" || option.value === "random"
                      ? "all"
                      : filters.multiplayerMode,
                })
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
        onFromChange={(from) => update({ from: from || undefined })}
        onToChange={(to) => update({ to: to || undefined })}
        onClear={() => update({ from: undefined, to: undefined })}
      />
      <SelectFilter
        label="多人赛制"
        value={filters.format}
        onChange={(format) =>
          update({ format: format as StatsFilters["format"] })
        }
      >
        <option value="all">全部赛制</option>
        <option value="bo1">BO1</option>
        <option value="bo3">BO3</option>
        <option value="bo5">BO5</option>
        <option value="bo7">BO7</option>
      </SelectFilter>
      <SelectFilter
        label="多人玩法"
        value={filters.multiplayerMode}
        onChange={(multiplayerMode) =>
          update({
            multiplayerMode: multiplayerMode as StatsFilters["multiplayerMode"],
          })
        }
      >
        <option value="all">全部玩法</option>
        <option value="race">竞速</option>
        <option value="relay">接力</option>
      </SelectFilter>
      <SelectFilter
        label="游戏难度"
        value={filters.difficulty ?? "all"}
        onChange={(difficulty) =>
          update({ difficulty: difficulty as StatsFilters["difficulty"] })
        }
      >
        {DIFFICULTY_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </SelectFilter>
    </section>
  );
}

function SelectFilter({
  children,
  label,
  onChange,
  value,
}: {
  children: React.ReactNode;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="h-4 text-xs font-bold leading-4 text-ink-soft">
        {label}
      </span>
      <select
        className="h-10 rounded-[5px] border border-line bg-[var(--surface)] px-3 text-sm text-ink"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
    </label>
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
