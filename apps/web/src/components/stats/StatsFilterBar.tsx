"use client";

import { Fragment, useState } from "react";
import { ConfigProvider, DatePicker } from "antd";
import zhCN from "antd/locale/zh_CN";
import dayjs, { type Dayjs } from "dayjs";
import "dayjs/locale/zh-cn";
import { Trash2 } from "lucide-react";
import { QUESTION_DIFFICULTY_LABELS } from "@touhouflandre/shared";
import type { StatsFilters } from "../../stats/types";
import {
  PAPER_DATE_PICKER_CLASS_NAME,
  PAPER_DATE_PICKER_POPUP_CLASS_NAME,
  Paper,
  PaperButton,
  PaperPicker,
  PaperSegmentButton,
  PaperSegmentGroup,
  PaperSegmentSeparator,
} from "@/components/paper";

type FilterOption<T extends string> = {
  value: T;
  label: string;
  separatorAfter?: boolean;
};

const MODE_OPTIONS: readonly FilterOption<StatsFilters["mode"]>[] = [
  { value: "all", label: "全部" },
  { value: "daily", label: "每日" },
  { value: "random", label: "随机" },
  { value: "multiplayer", label: "多人" },
];

const FORMAT_OPTIONS: readonly FilterOption<StatsFilters["format"]>[] = [
  { value: "all", label: "全部", separatorAfter: true },
  { value: "bo1", label: "BO1" },
  { value: "bo3", label: "BO3" },
  { value: "bo5", label: "BO5" },
  { value: "bo7", label: "BO7" },
];

const MULTIPLAYER_MODE_OPTIONS: readonly FilterOption<
  StatsFilters["multiplayerMode"]
>[] = [
  { value: "all", label: "全部", separatorAfter: true },
  { value: "race", label: "竞速" },
  { value: "relay", label: "接力" },
];

const DIFFICULTY_OPTIONS: readonly FilterOption<
  NonNullable<StatsFilters["difficulty"]>
>[] = [
  { value: "all", label: "全部", separatorAfter: true },
  { value: "easy", label: QUESTION_DIFFICULTY_LABELS.easy },
  { value: "normal", label: QUESTION_DIFFICULTY_LABELS.normal },
  { value: "hard", label: QUESTION_DIFFICULTY_LABELS.hard },
  {
    value: "lunatic",
    label: QUESTION_DIFFICULTY_LABELS.lunatic,
    separatorAfter: true,
  },
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
  const multiplayerOnlyDisabled =
    filters.mode === "daily" || filters.mode === "random";

  const updateMode = (mode: StatsFilters["mode"]) => {
    const singlePlayerMode = mode === "daily" || mode === "random";
    update({
      mode,
      format: singlePlayerMode ? "all" : filters.format,
      multiplayerMode: singlePlayerMode ? "all" : filters.multiplayerMode,
    });
  };

  return (
    <section className="stats-filter-section" aria-label="统计筛选">
      <div className="stats-filter-grid">
        <SegmentedFilter
          className="stats-mode-field"
          label="模式"
          onChange={updateMode}
          options={MODE_OPTIONS}
          value={filters.mode}
        />
        <DateRangeFilter
          from={filters.from ?? ""}
          to={filters.to ?? ""}
          onFromChange={(from) => update({ from: from || undefined })}
          onToChange={(to) => update({ to: to || undefined })}
          onClear={() => update({ from: undefined, to: undefined })}
        />
        <PickerFilter
          label="多人赛制"
          disabled={multiplayerOnlyDisabled}
          onChange={(format) => update({ format })}
          options={FORMAT_OPTIONS}
          value={filters.format}
        />
        <PickerFilter
          label="多人玩法"
          onChange={(multiplayerMode) => update({ multiplayerMode })}
          disabled={multiplayerOnlyDisabled}
          options={MULTIPLAYER_MODE_OPTIONS}
          value={filters.multiplayerMode}
        />
        <PickerFilter
          label="游戏难度"
          onChange={(difficulty) => update({ difficulty })}
          options={DIFFICULTY_OPTIONS}
          value={filters.difficulty ?? "all"}
        />
      </div>
    </section>
  );
}

function SegmentedFilter<T extends string>({
  className = "",
  label,
  onChange,
  options,
  value,
}: {
  className?: string;
  label: string;
  onChange: (value: T) => void;
  options: readonly FilterOption<T>[];
  value: T;
}) {
  return (
    <div className={`stats-filter-field ${className}`.trim()}>
      <span className="stats-filter-label">{label}</span>
      <div className="stats-filter-control-scroll">
        <PaperSegmentGroup label={label}>
          {options.map((option, index) => (
            <Fragment key={option.value}>
              {index > 0 ? <PaperSegmentSeparator /> : null}
              <PaperSegmentButton
                active={value === option.value}
                onClick={() => onChange(option.value)}
              >
                {option.label}
              </PaperSegmentButton>
            </Fragment>
          ))}
        </PaperSegmentGroup>
      </div>
    </div>
  );
}

function PickerFilter<T extends string>({
  disabled = false,
  label,
  onChange,
  options,
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: T) => void;
  options: readonly FilterOption<T>[];
  value: T;
}) {
  return (
    <label className="stats-filter-field">
      <span className="stats-filter-label">{label}</span>
      <PaperPicker
        aria-label={label}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as T)}
        value={value}
      >
        {options.map((option) => (
          <Fragment key={option.value}>
            <option value={option.value}>{option.label}</option>
            {option.separatorAfter ? <hr /> : null}
          </Fragment>
        ))}
      </PaperPicker>
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
  const hasDate = Boolean(from || to);
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);

  return (
    <div className="stats-filter-field stats-date-field">
      <span className="stats-filter-label">日期范围</span>
      <ConfigProvider locale={zhCN}>
        <div className="stats-date-range">
          <Paper
            animateOnMount={false}
            as="div"
            className={`stats-date-paper-button${fromDate ? " is-active" : ""}`}
            folded={false}
            foldSize={10}
            sticker={false}
            unfoldOnHover={false}
            unfolded={fromOpen}
            variant="plain"
          >
            <DatePicker
              className={PAPER_DATE_PICKER_CLASS_NAME}
              value={fromDate}
              format="YYYY-MM-DD"
              placeholder="开始日期"
              inputReadOnly
              allowClear={false}
              aria-label="开始日期"
              popupClassName={PAPER_DATE_PICKER_POPUP_CLASS_NAME}
              disabledDate={(current) =>
                Boolean(toDate && current.isAfter(toDate, "day"))
              }
              onOpenChange={setFromOpen}
              onChange={(value) => onFromChange(datePickerValue(value))}
            />
          </Paper>
          <span className="stats-date-connector" aria-hidden="true">
            —
          </span>
          <Paper
            animateOnMount={false}
            as="div"
            className={`stats-date-paper-button${toDate ? " is-active" : ""}`}
            folded={false}
            foldSize={10}
            sticker={false}
            unfoldOnHover={false}
            unfolded={toOpen}
            variant="plain"
          >
            <DatePicker
              className={PAPER_DATE_PICKER_CLASS_NAME}
              value={toDate}
              format="YYYY-MM-DD"
              placeholder="结束日期"
              inputReadOnly
              allowClear={false}
              aria-label="结束日期"
              popupClassName={PAPER_DATE_PICKER_POPUP_CLASS_NAME}
              disabledDate={(current) =>
                Boolean(fromDate && current.isBefore(fromDate, "day"))
              }
              onOpenChange={setToOpen}
              onChange={(value) => onToChange(datePickerValue(value))}
            />
          </Paper>
          <PaperSegmentSeparator />
          <PaperButton
            ariaLabel="清除日期筛选"
            disabled={!hasDate}
            className="stats-date-clear"
            folded={false}
            iconOnly
            onClick={onClear}
            title="清除日期筛选"
          >
            <Trash2 size={17} aria-hidden="true" />
          </PaperButton>
        </div>
      </ConfigProvider>
    </div>
  );
}

function datePickerValue(value: Dayjs | null): string {
  return value?.format("YYYY-MM-DD") ?? "";
}
