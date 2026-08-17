"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { QUESTION_DIFFICULTY_LABELS } from "@touhouflandre/shared";
import {
  MULTIPLAYER_MODE_LABELS,
  ROOM_FORMAT_SHORT,
} from "../../domain/multiRoom";
import { displayGuessesForRecord, selfScore } from "../../stats/aggregate";
import type {
  MultiplayerStatsRecord,
  StatsDifficulty,
  StatsOutcome,
  StatsRecord,
  StatsRound,
} from "../../stats/types";
import {
  Paper,
  PaperButton,
  PaperDataTable,
  PaperDataTableBody,
  PaperDataTableHeader,
  PaperDataTableDetail,
  PaperPicker,
  PaperSegmentGroup,
  PaperSegmentSeparator,
} from "@/components/paper";
import { CharacterAvatar } from "../game/CharacterAvatar";

const OUTCOME_LABELS: Record<StatsOutcome, string> = {
  win: "成功",
  loss: "失败",
  draw: "平局",
  forfeit: "放弃",
  abandoned: "已重开",
  disconnect: "断线判负",
  incomplete: "同步不完整",
};

export function StatsHistory({ records }: { records: StatsRecord[] }) {
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [records, pageSize]);
  const pageCount = Math.max(1, Math.ceil(records.length / pageSize));
  const visible = records.slice((page - 1) * pageSize, page * pageSize);

  return (
    <PaperDataTable>
      <section className="stats-history">
        <div className="stats-history-sticky">
          <HistoryHeading
            onNext={() => setPage((value) => value + 1)}
            onPageSizeChange={setPageSize}
            onPrevious={() => setPage((value) => value - 1)}
            page={page}
            pageCount={pageCount}
            pageSize={pageSize}
            recordCount={records.length}
          />
          <PaperDataTableHeader
            ariaLabel="游玩记录表头"
            className="stats-history-table-header-scroll"
          >
            <HistoryTableHeader />
          </PaperDataTableHeader>
        </div>

        <PaperDataTableBody
          ariaLabel="游玩记录"
          className="stats-history-paper"
          responsiveStacked
          viewportClassName="stats-history-ledger"
        >
          <div className="paper-data-table-body" role="rowgroup">
            <HistoryEntries records={visible} />
          </div>
        </PaperDataTableBody>
      </section>
    </PaperDataTable>
  );
}

function HistoryHeading({
  onNext,
  onPageSizeChange,
  onPrevious,
  page,
  pageCount,
  pageSize,
  recordCount,
}: {
  onNext: () => void;
  onPageSizeChange: (value: number) => void;
  onPrevious: () => void;
  page: number;
  pageCount: number;
  pageSize: number;
  recordCount: number;
}) {
  return (
    <div className="stats-history-heading">
      <div>
        <h2>游玩记录</h2>
        <p>共 {recordCount} 条本地记录。</p>
      </div>
      <div className="stats-history-heading-controls">
        <HistoryPageSizeControl
          pageSize={pageSize}
          onChange={onPageSizeChange}
        />
        <HistoryPagination
          onNext={onNext}
          onPrevious={onPrevious}
          page={page}
          pageCount={pageCount}
        />
      </div>
    </div>
  );
}

function HistoryPageSizeControl({
  onChange,
  pageSize,
}: {
  onChange: (value: number) => void;
  pageSize: number;
}) {
  return (
    <label className="stats-history-page-size">
      <span>每页</span>
      <PaperPicker
        aria-label="每页记录数"
        value={pageSize}
        variant="plain"
        onChange={(event) => onChange(Number(event.target.value))}
      >
        <option value={10}>10</option>
        <option value={25}>25</option>
        <option value={50}>50</option>
      </PaperPicker>
      <span>条</span>
    </label>
  );
}

function HistoryTableHeader() {
  return (
    <div
      className="stats-history-ledger-header paper-data-table-header paper-data-table-row"
      role="row"
    >
      <span role="columnheader">开始时间</span>
      <span role="columnheader">模式</span>
      <span role="columnheader">难度</span>
      <span role="columnheader">结果</span>
      <span role="columnheader">猜测次数</span>
      <span role="columnheader">总耗时</span>
      <span role="columnheader">所猜角色</span>
      <span role="columnheader">答案</span>
    </div>
  );
}

function HistoryPagination({
  onNext,
  onPrevious,
  page,
  pageCount,
}: {
  onNext: () => void;
  onPrevious: () => void;
  page: number;
  pageCount: number;
}) {
  return (
    <PaperSegmentGroup className="stats-history-pagination" label="记录翻页">
      <PaperButton
        ariaLabel="上一页"
        disabled={page <= 1}
        filled={page > 1}
        folded={page > 1}
        iconOnly
        onClick={onPrevious}
        title="上一页"
        tone="theme"
      >
        <ChevronLeft size={20} aria-hidden="true" />
      </PaperButton>
      <PaperSegmentSeparator />
      <Paper
        animateOnMount={false}
        as="span"
        className="stats-history-page-counter"
        folded={false}
        sticker={false}
        unfoldOnHover={false}
        variant="plain"
      >
        <span aria-live="polite">
          {page} / {pageCount}
        </span>
      </Paper>
      <PaperSegmentSeparator />
      <PaperButton
        ariaLabel="下一页"
        disabled={page >= pageCount}
        filled={page < pageCount}
        folded={page < pageCount}
        iconOnly
        onClick={onNext}
        title="下一页"
        tone="theme"
      >
        <ChevronRight size={20} aria-hidden="true" />
      </PaperButton>
    </PaperSegmentGroup>
  );
}

function HistoryEntries({ records }: { records: StatsRecord[] }) {
  if (records.length === 0) {
    return (
      <div className="stats-history-empty" role="row">
        <span role="cell">暂无游玩记录</span>
      </div>
    );
  }

  return records.map((record) => (
    <HistoryEntry key={record.id} record={record} />
  ));
}

function HistoryEntry({ record }: { record: StatsRecord }) {
  const [open, setOpen] = useState(false);
  const rounds = record.kind === "single" ? [record.round] : record.rounds;
  const guesses = displayGuessesForRecord(record);

  return (
    <div className="stats-history-entry paper-data-table-entry">
      <div className="stats-history-ledger-row paper-data-table-row" role="row">
        <div
          className="stats-history-cell stats-history-time"
          data-label="开始时间"
          role="cell"
        >
          {formatDateTime(record.startedAt)}
        </div>
        <div
          className="stats-history-cell stats-history-mode"
          data-label="模式"
          role="cell"
        >
          <span className="stats-history-mode-copy">{modeLabel(record)}</span>
          <DetailsButton
            expanded={open}
            record={record}
            onToggle={() => setOpen((value) => !value)}
          />
        </div>
        <div className="stats-history-cell" data-label="难度" role="cell">
          {difficultyLabel(record.difficulty ?? "unknown")}
        </div>
        <div
          className={`paper-tinted-cell stats-history-cell stats-history-outcome-cell ${statsOutcomeClass(record.outcome)}`}
          data-label="结果"
          role="cell"
        >
          <Outcome outcome={record.outcome} />
        </div>
        <div
          className="stats-history-cell stats-history-number"
          data-label="猜测次数"
          role="cell"
        >
          {guesses.length}
        </div>
        <div
          className="stats-history-cell stats-history-number"
          data-label="总耗时"
          role="cell"
        >
          {formatDuration(record.durationMs)}
        </div>
        <div
          className="stats-history-cell stats-history-sequence"
          data-label="所猜角色"
          role="cell"
        >
          <GuessSequence guesses={guesses} />
        </div>
        <div
          className="stats-history-cell stats-history-sequence stats-history-answer"
          data-label="答案"
          role="cell"
        >
          <AnswerSequence rounds={rounds} />
        </div>
      </div>
      <ExpandedRoundDetails open={open} record={record} />
    </div>
  );
}

function statsOutcomeClass(outcome: StatsOutcome) {
  if (outcome === "win") return "stats-history-outcome-success";
  if (outcome === "draw") return "stats-history-outcome-draw";
  return "stats-history-outcome-failure";
}

function DetailsButton({
  expanded,
  onToggle,
  record,
}: {
  expanded: boolean;
  onToggle: () => void;
  record: StatsRecord;
}) {
  if (record.kind !== "multiplayer") return null;

  return (
    <PaperButton
      ariaExpanded={expanded}
      ariaLabel={expanded ? "收起局详情" : "查看局详情"}
      className="stats-history-detail-button"
      folded={false}
      onClick={onToggle}
      title="查看局详情"
    >
      <span>详情</span>
      <ChevronDown
        className={expanded ? "rotate-180" : ""}
        size={16}
        aria-hidden="true"
      />
    </PaperButton>
  );
}

function ExpandedRoundDetails({
  open,
  record,
}: {
  open: boolean;
  record: StatsRecord;
}) {
  if (!open || record.kind !== "multiplayer") return null;

  return (
    <PaperDataTableDetail className="stats-history-rounds">
      <RoundDetails record={record} />
    </PaperDataTableDetail>
  );
}

function Outcome({ outcome }: { outcome: StatsOutcome }) {
  return <span className="stats-outcome">{OUTCOME_LABELS[outcome]}</span>;
}

function GuessSequence({
  guesses,
}: {
  guesses: ReturnType<typeof displayGuessesForRecord>;
}) {
  if (!guesses.length) {
    return <span className="text-xs text-ink-soft">未猜测</span>;
  }
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
  const placement = record.scoringMode === "placement";
  return (
    <div className="grid gap-2">
      {record.rounds.map((round) => (
        <div key={round.roundIndex} className="stats-history-round">
          <strong>第 {round.roundIndex} 局</strong>
          <span
            className={
              placement
                ? round.pointsAwarded
                  ? "font-bold text-jade"
                  : "text-ink-soft"
                : round.result === "win"
                  ? "text-jade"
                  : "text-[var(--error-text)]"
            }
          >
            {placement
              ? `+${round.pointsAwarded ?? 0} 分 · ${participationLabel(round.participationStatus)}`
              : round.result === "win"
                ? "胜"
                : round.result === "loss"
                  ? "负"
                  : "平"}
          </span>
          <span className="stats-history-round-duration">
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

function participationLabel(status: StatsRound["participationStatus"]): string {
  switch (status) {
    case "correct":
      return "猜中";
    case "forfeited":
      return "放弃";
    case "exhausted":
      return "次数耗尽";
    case "timed_out":
      return "超时";
    default:
      return "未得分";
  }
}

function modeLabel(record: StatsRecord): string {
  if (record.kind === "single") {
    return record.mode === "daily" ? "每日" : "随机";
  }
  const multiplayerMode =
    MULTIPLAYER_MODE_LABELS[record.multiplayerMode ?? "race"];
  const rosterLabel =
    (record.rosterSize ?? 2) > 2
      ? ` · ${record.rosterSize} 人/${record.playerLimit ?? record.rosterSize}`
      : "";
  if (record.scoringMode === "placement") {
    const rank = record.finalRank
      ? ` · ${record.tiedForFirst ? "并列" : ""}第 ${record.finalRank} 名`
      : "";
    const eliminated = record.eliminatedRound
      ? ` · 第 ${record.eliminatedRound} 局淘汰`
      : "";
    return `${multiplayerMode} · 积分制 · ${record.scoreSelf} 分${rank}${eliminated}${rosterLabel}`;
  }
  return `${multiplayerMode} · ${ROOM_FORMAT_SHORT[record.format]} · ${selfScore(record)}${rosterLabel}`;
}

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

function difficultyLabel(value: StatsDifficulty): string {
  return value === "unknown" ? "未知" : QUESTION_DIFFICULTY_LABELS[value];
}
