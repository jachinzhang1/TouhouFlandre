"use client";

// 联机棋盘复用单人模式的全宽台账：字段标签固定在表尾，反馈单元格与行高一致。
// 对手行保留相同几何，但只公开匿名状态，不携带角色名或属性值（08 §4.5）。
import type { ReactNode } from "react";
import type {
  FeedbackStatus,
  GuessField,
  GuessFieldKey,
} from "@touhouflandre/shared";
import { CHARACTER_GUESS_FIELDS } from "@touhouflandre/shared";
import { CharacterAvatar } from "./CharacterAvatar";
import { FeedbackStatusIcon } from "./FeedbackStatusIcon";
import { Paper } from "@/components/paper";
import { SectionHeading } from "../layout/SectionHeading";

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
  highlightTone = "success",
}: {
  title?: string;
  subtitle?: ReactNode;
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
      className="multiplayer-board"
      data-board-variant={variant}
      data-highlight={highlight ? "true" : "false"}
      data-highlight-tone={highlight ? highlightTone : undefined}
    >
      {title || subtitle || headerExtra ? (
        <SectionHeading
          action={headerExtra}
          className="multiplayer-board-heading"
          description={subtitle}
          title={title ?? "棋盘"}
          titleAs="h2"
        />
      ) : null}
      <div className="multiplayer-board-scroll">
        <Paper
          animateOnMount={false}
          as="div"
          elevation="sm"
          className="paper-data-table multiplayer-board-paper"
          folded={false}
          pattern={false}
          tone={highlight ? highlightTone : "default"}
          sticker={false}
          unfoldOnHover={false}
          variant="plain"
        >
          <table className="guess-table multiplayer-guess-table">
            <colgroup>
              <col className="guess-character-column" />
              {fields.map((field) => (
                <col className="guess-feedback-column" key={field.key} />
              ))}
            </colgroup>
            <tbody className="paper-data-table-body">
              {rows.length === 0 ? (
                <tr className="paper-data-table-row multiplayer-board-empty-row">
                  <td colSpan={fields.length + 1}>{emptyLabel}</td>
                </tr>
              ) : (
                rows.map((row, rowIndex) => {
                  if (row.notice) {
                    return (
                      <tr
                        className="paper-data-table-row guess-timeout-row"
                        key={row.key}
                      >
                        <th scope="row" className="guess-timeout-cell">
                          <span>{row.notice}</span>
                        </th>
                        {fields.map((field) => (
                          <td
                            aria-hidden="true"
                            className="guess-timeout-placeholder-cell"
                            key={field.key}
                          />
                        ))}
                      </tr>
                    );
                  }

                  const cells = cellsForFields(row.cells, fields);
                  return (
                    <tr
                      className={`paper-data-table-row${row.isCorrect ? " guess-correct-row" : ""}`}
                      key={row.key}
                      style={{
                        animationDelay: `${Math.min(rowIndex, 7) * 45}ms`,
                      }}
                    >
                      <th scope="row">
                        {row.name ? (
                          <span className="guess-character">
                            <CharacterAvatar
                              avatarUrl={row.avatarUrl}
                              name={row.name}
                              initials={row.name.slice(0, 2)}
                              className="guess-avatar"
                            />
                            <span>{row.name}</span>
                          </span>
                        ) : (
                          <span className="multiplayer-anonymous-guess">
                            第 {row.key} 猜
                          </span>
                        )}
                      </th>
                      {cells.map((cell, index) => (
                        <td
                          className={`paper-tinted-cell feedback-cell feedback-cell-${cell.status}`}
                          key={fields[index]?.key ?? index}
                        >
                          <span
                            aria-label={
                              isOpponent ? STATUS_LABEL[cell.status] : undefined
                            }
                            className={`feedback${isOpponent ? " match-feedback-compact" : ""}`}
                            role={isOpponent ? "img" : undefined}
                            title={STATUS_LABEL[cell.status]}
                          >
                            <b>
                              <FeedbackStatusIcon
                                status={cell.status}
                                decorative={isOpponent}
                              />
                            </b>
                            {!isOpponent && cell.value ? (
                              <span>{cell.value}</span>
                            ) : null}
                          </span>
                        </td>
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
            <tfoot className="paper-data-table-header single-game-history-footer multiplayer-board-footer">
              <tr className="paper-data-table-row">
                <th>角色</th>
                {fields.map((field) => (
                  <th key={field.key}>{field.label}</th>
                ))}
              </tr>
            </tfoot>
          </table>
        </Paper>
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
