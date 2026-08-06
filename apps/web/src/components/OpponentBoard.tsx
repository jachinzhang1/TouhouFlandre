"use client";

// 对手匿名矩阵（08 §4.5/§10.4）：只渲染状态颜色，无列头/角色名/标签/值；
// 单元格 aria-label 携带状态名（颜色不唯一表达）。
import type { components } from "../generated/api";

type FeedbackStatus = components["schemas"]["FeedbackStatus"];
type OpponentRow = components["schemas"]["OpponentRow"];

const STATUS_CLASS: Record<FeedbackStatus, string> = {
  exact: "bg-jade",
  partial: "bg-amber",
  miss: "bg-ink",
  higher: "bg-sky-400",
  lower: "bg-indigo-500",
  unknown: "border border-dashed border-line-strong bg-transparent",
};

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  exact: "命中",
  partial: "部分",
  miss: "未中",
  higher: "更高",
  lower: "更低",
  unknown: "未知",
};

export const OPPONENT_LEGEND = [
  { status: "exact" as const, symbol: "O", label: "命中" },
  { status: "partial" as const, symbol: "~", label: "部分" },
  { status: "miss" as const, symbol: "X", label: "未中" },
  { status: "higher" as const, symbol: "↑", label: "更高" },
  { status: "lower" as const, symbol: "↓", label: "更低" },
  { status: "unknown" as const, symbol: "?", label: "未知" },
];

export function OpponentBoard({ rows }: { rows: OpponentRow[] }) {
  return (
    <div className="rounded-[6px] border border-line bg-paper p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="m-0 text-[0.8rem] font-bold text-ink-soft">对手</h3>
        <details className="text-[0.72rem] text-ink-soft">
          <summary className="cursor-pointer">图例</summary>
          <ul className="mt-2 grid grid-cols-3 gap-1.5">
            {OPPONENT_LEGEND.map((item) => (
              <li key={item.status} className="flex items-center gap-1.5">
                <span
                  className={`inline-block size-3.5 rounded-[3px] ${STATUS_CLASS[item.status]}`}
                  aria-hidden="true"
                />
                <span>
                  {item.symbol} {item.label}
                </span>
              </li>
            ))}
          </ul>
        </details>
      </div>
      {rows.length === 0 ? (
        <p className="m-0 py-3 text-center text-[0.8rem] text-ink-soft">
          等待对方猜测……
        </p>
      ) : (
        <table className="w-full border-separate border-spacing-1">
          <tbody>
            {rows.map((row) => (
              <tr key={row.index}>
                {row.statuses.map((status, i) => (
                  <td key={i} className="p-0">
                    <span
                      className={`block h-7 rounded-[3px] ${STATUS_CLASS[status] ?? ""}`}
                      aria-label={STATUS_LABEL[status] ?? status}
                      role="img"
                      title={STATUS_LABEL[status] ?? status}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
