"use client";

// 联机对局棋盘表格（左右双栏：左自己 / 右对手，手机端上下堆叠）：
// 列标签只出现一次（表头，复用单人模式字段序）；单元格统一 feedback feedback-{status}
// 语义类（两边同色同高）；对手匿名行只渲染状态色块，永不含名称/标签/值（08 §4.5）。
import type { ReactNode } from "react";
import type {
  FeedbackStatus,
  GuessField,
  GuessFieldKey,
} from "@touhouflandre/shared";
import { CHARACTER_GUESS_FIELDS } from "@touhouflandre/shared";
import { CharacterAvatar } from "./CharacterAvatar";
import { FeedbackStatusIcon } from "./FeedbackStatusIcon";

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
}: {
  title?: string;
  subtitle?: string;
  headerExtra?: ReactNode;
  rows: GuessRow[];
  emptyLabel: string;
  variant?: GuessTableVariant;
  fields?: readonly GuessField[];
  highlight?: boolean;
}) {
  const isOpponent = variant === "opponent";

  return (
    <div className={`rounded-[6px] border bg-paper p-3 shadow-sm ${highlight ? "border-jade" : "border-line"}`}>
      {(title || subtitle || headerExtra) && (
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {title && <h3 className="m-0 text-[0.8rem] font-bold text-ink-soft">{title}</h3>}
            {subtitle && <span className="text-[0.72rem] text-ink-soft">{subtitle}</span>}
          </div>
          {headerExtra}
        </div>
      )}
      <div className="overflow-x-auto">
        <table
          className={`w-full border-collapse text-[0.78rem] ${
            isOpponent ? "min-w-[430px]" : "min-w-[560px]"
          }`}
        >
          <thead>
            <tr>
              <th
                className={`border-b border-line bg-paper-muted p-2 text-left text-[0.72rem] font-bold text-ink-soft ${
                  isOpponent ? "w-16" : "w-24"
                }`}
              >
                角色
              </th>
              {fields.map((field) => (
                <th
                  key={field.key}
                  className="border-b border-line bg-paper-muted p-2 text-left text-[0.72rem] font-bold text-ink-soft"
                >
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
              rows.map((row) => {
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
                        <span className="flex items-center gap-1.5">
                          <CharacterAvatar
                            avatarUrl={row.avatarUrl}
                            name={row.name}
                            initials={row.name.slice(0, 1)}
                            className="!size-5 shrink-0"
                          />
                          <span className="min-w-0 overflow-wrap-anywhere">
                            {row.name}
                            {row.isCorrect && (
                              <span className="ml-1 rounded bg-jade-soft px-1 py-0.5 text-[0.62rem] font-bold text-jade">
                                命中
                              </span>
                            )}
                          </span>
                        </span>
                      ) : (
                        <span className="text-ink-soft">第 {row.key} 猜</span>
                      )}
                    </th>
                    {cells.map((cell, index) => (
                      <td
                        key={fields[index]?.key ?? index}
                        className="border-b border-line p-1.5 align-top"
                      >
                        <span
                          className={`feedback match-feedback ${
                            isOpponent ? "match-feedback-compact" : ""
                          } feedback-${cell.status}`}
                          title={STATUS_LABEL[cell.status]}
                          role={row.name ? undefined : "img"}
                          aria-label={row.name ? undefined : STATUS_LABEL[cell.status]}
                        >
                          <b>
                            <FeedbackStatusIcon
                              status={cell.status}
                              decorative={!row.name}
                            />
                          </b>
                          {!isOpponent && cell.value && <span>{cell.value}</span>}
                        </span>
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function cellsForFields(
  cells: GuessRow["cells"],
  fields: readonly GuessField[],
): GuessCell[] {
  const fallback = fields.map((_, index) => cells?.[index] ?? { status: "unknown" as const });
  if (!cells?.some((cell) => cell.field)) return fallback;

  const byField = new Map<GuessFieldKey, GuessCell>();
  for (const cell of cells) {
    if (cell.field) byField.set(cell.field, cell);
  }
  if (!fields.every((field) => byField.has(field.key))) return fallback;
  return fields.map((field) => byField.get(field.key)!);
}
