"use client";

// 对手匿名矩阵（08 §4.5/§10.4）：只渲染状态色块，无名称/标签/值；
// 颜色序列与自视角/单人一致（统一 feedback feedback-{status} 语义类，同色同高）。
// 单元格 role="img" + aria-label 携带状态名（颜色不唯一表达，08 §10.4）。
import type { components } from "../generated/api";
import { FeedbackStatusIcon } from "./FeedbackStatusIcon";
import { GuessTable, STATUS_LABEL, type GuessRow } from "./GuessTable";

type FeedbackStatus = components["schemas"]["FeedbackStatus"];
type OpponentRow = components["schemas"]["OpponentRow"];

// 图例色块：与 feedback 语义类的强调色一致（exact=jade、partial/higher/lower=amber、miss/unknown=灰）。
const LEGEND_SWATCH: Record<FeedbackStatus, string> = {
  exact: "bg-jade",
  partial: "bg-amber",
  miss: "bg-[#697873]",
  higher: "bg-amber",
  lower: "bg-amber",
  unknown: "bg-[#697873]",
};

export function OpponentBoard({ rows }: { rows: OpponentRow[] }) {
  const tableRows: GuessRow[] = rows.map((row) => ({
    key: String(row.index),
    cells: row.statuses.map((status) => ({
      status,
      // 匿名：不携带值
    })),
  }));

  return (
    <GuessTable
      title="对手"
      variant="opponent"
      headerExtra={
        <details className="shrink-0 text-[0.72rem] text-ink-soft">
          <summary className="cursor-pointer">图例</summary>
          <ul className="mt-2 grid grid-cols-3 gap-1.5">
            {(Object.keys(LEGEND_SWATCH) as FeedbackStatus[]).map((status) => (
              <li key={status} className="flex items-center gap-1.5">
                <span
                  className={`inline-flex size-5 items-center justify-center rounded-[3px] text-white ${LEGEND_SWATCH[status]}`}
                >
                  <FeedbackStatusIcon status={status} decorative size={12} />
                </span>
                <span>{STATUS_LABEL[status]}</span>
              </li>
            ))}
          </ul>
        </details>
      }
      rows={tableRows}
      emptyLabel="等待对方猜测……"
    />
  );
}
