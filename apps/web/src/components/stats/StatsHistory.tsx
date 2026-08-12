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
import { CharacterAvatar } from "../CharacterAvatar";

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
  const guesses = displayGuessesForRecord(record);
  const modeLabel =
    record.kind === "multiplayer"
      ? MULTIPLAYER_MODE_LABELS[record.multiplayerMode ?? "race"]
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
            : `${modeLabel} · ${ROOM_FORMAT_SHORT[record.format]} · ${selfScore(record)}`}
        </td>
        <td className="px-4 py-3 text-xs font-bold text-ink-soft">
          {difficultyLabel(record.difficulty ?? "unknown")}
        </td>
        <td className="px-4 py-3">
          <Outcome outcome={record.outcome} />
        </td>
        <td className="px-4 py-3 tabular-nums text-ink">{guesses.length}</td>
        <td className="px-4 py-3 tabular-nums text-ink">
          {formatDuration(record.durationMs)}
        </td>
        <td className="px-4 py-2">
          <GuessSequence guesses={guesses} />
        </td>
        <td className="px-4 py-2">
          <AnswerSequence rounds={rounds} />
        </td>
        <td className="px-3 py-2 text-right">
          {record.kind === "multiplayer" ? (
            <button
              type="button"
              className="inline-flex size-8 items-center justify-center rounded-[4px] text-ink-soft hover:bg-[var(--surface-soft)]"
              aria-label="查看局详情"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              <ChevronDown className={open ? "rotate-180" : ""} size={16} />
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
