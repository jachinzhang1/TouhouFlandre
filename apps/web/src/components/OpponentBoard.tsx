"use client";

// 对手匿名矩阵（08 §4.5/§10.4）：只渲染状态色块，无名称/标签/值；
// 颜色序列与自视角/单人一致（统一 feedback feedback-{status} 语义类，同色同高）。
// 单元格 role="img" + aria-label 携带状态名（颜色不唯一表达，08 §10.4）。
import type { components } from "../generated/api";
import { GuessTable, STATUS_LABEL, STATUS_SYMBOL, type GuessRow } from "./GuessTable";

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
      symbol: STATUS_SYMBOL[status],
      // 匿名：不携带值
    })),
  }));

  return (
    <div className="rounded-[6px] border border-line bg-paper p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="m-0 text-[0.8rem] font-bold text-ink-soft">对手</h3>
        <details className="text-[0.72rem] text-ink-soft">
          <summary className="cursor-pointer">图例</summary>
          <ul className="mt-2 grid grid-cols-3 gap-1.5">
            {(Object.keys(STATUS_SYMBOL) as FeedbackStatus[]).map((status) => (
              <li key={status} className="flex items-center gap-1.5">
                <span
                  className={`inline-block size-3.5 rounded-[3px] ${LEGEND_SWATCH[status]}`}
                  aria-hidden="true"
                />
                <span>
                  {STATUS_SYMBOL[status]} {STATUS_LABEL[status]}
                </span>
              </li>
            ))}
          </ul>
        </details>
      </div>
      <GuessTable
        rows={tableRows}
        emptyLabel="等待对方猜测……"
      />
    </div>
  );
}
