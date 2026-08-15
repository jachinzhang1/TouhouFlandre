import type { FeedbackStatus } from "@touhouflandre/shared";
import { FeedbackStatusIcon } from "./FeedbackStatusIcon";

export const FEEDBACK_LEGEND_ITEMS: {
  status: FeedbackStatus;
  label: string;
  shortLabel: string;
}[] = [
  { status: "exact", label: "该属性完全命中", shortLabel: "命中" },
  { status: "partial", label: "该属性仅部分命中", shortLabel: "部分命中" },
  {
    status: "higher",
    label: "该属性正确答案的数值高于本条猜测",
    shortLabel: "答案更高",
  },
  {
    status: "lower",
    label: "该属性正确答案的数值低于本条猜测",
    shortLabel: "答案更低",
  },
  { status: "miss", label: "该属性完全未命中", shortLabel: "未命中" },
  {
    status: "unknown",
    label: "属性值缺失或无法判断，若遇到请反馈",
    shortLabel: "未知",
  },
];

export function FeedbackLegend({ className = "" }: { className?: string }) {
  return (
    <div
      aria-label="反馈图例"
      className={`feedback-legend-row ${className}`.trim()}
      role="list"
    >
      {FEEDBACK_LEGEND_ITEMS.map((item) => (
        <div
          className="feedback-legend-row-item"
          key={item.status}
          role="listitem"
          title={item.label}
        >
          <span
            className={`feedback-legend-icon feedback-${item.status}`}
            aria-hidden="true"
          >
            <b>
              <FeedbackStatusIcon decorative size={13} status={item.status} />
            </b>
          </span>
          <span>{item.shortLabel}</span>
        </div>
      ))}
    </div>
  );
}
