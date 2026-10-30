"use client";

// 联机对局棋盘表格（左右双栏：左自己 / 右对手，手机端上下堆叠）：
// 列标签只出现一次（表头，复用单人模式字段序）；单元格统一 feedback feedback-{status}
// 语义类（两边同色同高）；对手匿名行只渲染状态色块，永不含名称/标签/值（08 §4.5）。
import type { ReactNode } from "react";
import {
  CHARACTER_GUESS_FIELDS,
  type FeedbackStatus,
  type GuessField,
  type GuessFieldKey,
  type MatchKind,
} from "@touhouflandre/shared";
import { CharacterAvatar } from "./CharacterAvatar";
import { FeedbackStatusIcon } from "./FeedbackStatusIcon";
import { Paper } from "../paper";

export const STATUS_LABEL: Record<FeedbackStatus, string> = {
  exact: "命中",
  partial: "部分",
  miss: "未中",
  higher: "更高",
  lower: "更低",
  unknown: "未知",
};

export type GuessCell = {
  field?: GuessFieldKey;
  status: FeedbackStatus;
  /** 匿名行不传（只渲染状态色块，不泄露值）。 */
  value?: string;
};

export type GuessRow = {
  key: string;
  notice?: string;
  tone?: "danger";
  /** 匿名行为空（角色列显示行号「第 N 猜」）。 */
  name?: string;
  avatarUrl?: string;
  isCorrect?: boolean;
  matchKind?: MatchKind;
  cells?: GuessCell[];
};

export type GuessTableVariant = "self" | "opponent";

export function GuessTable({
  title,
  subtitle,
  headerExtra,
  rows,
  emptyLabel,
  variant = "self",
  fields = CHARACTER_GUESS_FIELDS,
  highlight = false,
  highlightTone = "success",
}: {
  title?: string;
  subtitle?: string;
  headerExtra?: ReactNode;
  rows: GuessRow[];
  emptyLabel: string;
  variant?: GuessTableVariant;
  fields?: readonly GuessField[];
  highlight?: boolean;
  highlightTone?: "success" | "danger";
}) {
  const isOpponent = variant === "opponent";
  return (
    <section
      className="multiplayer-board min-w-0"
      data-board-variant={variant}
      data-highlight={highlight}
      data-highlight-tone={highlightTone}
    >
      {title || subtitle || headerExtra ? (
        <div className="mb-2.5 flex min-h-9 min-w-0 items-center justify-between gap-2.5">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1.5">
            {title ? (
              <h3 className="m-0 font-brand text-base font-black overflow-wrap-anywhere">
                {title}
              </h3>
            ) : null}
            {subtitle ? (
              <span className="text-[0.72rem] text-ink-soft">{subtitle}</span>
            ) : null}
          </div>
          {headerExtra}
        </div>
      ) : null}
      <div className="relative isolate min-w-0">
        <div
          aria-label={isOpponent ? (title ?? "对手猜测记录") : "我的猜测记录"}
          className="multiplayer-board-scroll max-w-full"
          role="region"
          tabIndex={0}
        >
          <Paper
            as="div"
            className="guess-record-paper multiplayer-board-paper"
            animateOnMount={false}
            folded={false}
            sticker={false}
            unfoldOnHover={false}
          >
            <table className="guess-table guess-record-table multiplayer-guess-table">
              <thead className="paper-data-table-header multiplayer-board-footer">
                <tr>
                  <th scope="col">{isOpponent ? "猜测" : "角色"}</th>
                  {fields.map((field) => (
                    <th key={field.key} scope="col">
                      {field.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={fields.length + 1}
                      className="py-4 text-center text-ink-soft"
                    >
                      {emptyLabel}
                    </td>
                  </tr>
                ) : (
                  rows.map((row, rowIndex) => {
                    if (row.notice) {
                      return (
                        <tr key={row.key}>
                          <td
                            colSpan={fields.length + 1}
                            className="border-b border-line p-2"
                          >
                            <span
                              className={`inline-flex rounded px-2 py-1 text-[0.72rem] font-black ${
                                row.tone === "danger"
                                  ? "bg-vermilion-soft text-vermilion"
                                  : "bg-paper-muted text-ink-soft"
                              }`}
                            >
                              {row.notice}
                            </span>
                          </td>
                        </tr>
                      );
                    }

                    const cells = cellsForFields(row.cells, fields);
                    return (
                      <tr key={row.key}>
                        <th
                          scope="row"
                          className="border-b border-line p-1.5 align-top text-left font-normal"
                        >
                          {row.name ? (
                            <span className="guess-character">
                              <CharacterAvatar
                                avatarUrl={row.avatarUrl}
                                name={row.name}
                                initials={row.name.slice(0, 1)}
                                className="!size-[30px] shrink-0"
                              />
                              <span className="min-w-0 overflow-wrap-anywhere">
                                {row.name}
                                {row.isCorrect && (
                                  <span className="ml-1 rounded bg-jade-soft px-1 py-0.5 text-[0.62rem] font-bold text-jade">
                                    {row.matchKind === "equivalent"
                                      ? "等价命中"
                                      : "命中"}
                                  </span>
                                )}
                              </span>
                            </span>
                          ) : (
                            <span className="whitespace-nowrap font-brand text-[0.68rem] font-bold text-ink-soft">
                              第 {rowIndex + 1} 猜
                            </span>
                          )}
                        </th>
                        {cells.map((cell, index) => (
                          <td
                            key={fields[index]?.key ?? index}
                            className={`feedback-cell feedback-cell-${cell.status} paper-tinted-cell border-b border-line p-1.5 align-top ${isOpponent ? "multiplayer-icon-feedback-cell" : ""}`}
                          >
                            <span
                              className={`feedback match-feedback ${
                                isOpponent ? "match-feedback-compact" : ""
                              } feedback-${cell.status}`}
                              title={STATUS_LABEL[cell.status]}
                              role={row.name ? undefined : "img"}
                              aria-label={
                                row.name ? undefined : STATUS_LABEL[cell.status]
                              }
                            >
                              <b>
                                <FeedbackStatusIcon
                                  status={cell.status}
                                  decorative={!row.name}
                                />
                              </b>
                              {!isOpponent && cell.value && (
                                <span>{cell.value}</span>
                              )}
                            </span>
                          </td>
                        ))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </Paper>
        </div>
        {highlight ? (
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 z-10 border-2 ${highlightTone === "danger" ? "border-[var(--semantic-danger)]" : "border-[var(--semantic-success)]"}`}
          />
        ) : null}
      </div>
    </section>
  );
}

function cellsForFields(
  cells: GuessRow["cells"],
  fields: readonly GuessField[],
): GuessCell[] {
  const fallback = fields.map(
    (_, index) => cells?.[index] ?? { status: "unknown" as const },
  );
  if (!cells?.some((cell) => cell.field)) return fallback;

  const byField = new Map<GuessFieldKey, GuessCell>();
  for (const cell of cells) {
    if (cell.field) byField.set(cell.field, cell);
  }
  if (!fields.every((field) => byField.has(field.key))) return fallback;
  return fields.map((field) => byField.get(field.key)!);
}
