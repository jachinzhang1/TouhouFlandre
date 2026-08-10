"use client";

import { Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { FeedbackStatus } from "@touhouflandre/shared";
import { FeedbackStatusIcon } from "./FeedbackStatusIcon";

export const FEEDBACK_LEGEND_ITEMS: {
  status: FeedbackStatus;
  label: string;
}[] = [
  { status: "exact", label: "该属性完全命中" },
  { status: "partial", label: "该属性仅部分命中" },
  { status: "higher", label: "该属性正确答案的数值高于本条猜测" },
  { status: "lower", label: "该属性正确答案的数值低于本条猜测" },
  { status: "miss", label: "该属性完全未命中" },
  { status: "unknown", label: "属性值缺失或无法判断，若遇到请反馈" },
];

export function FeedbackLegendButton({
  className = "",
  placement = "below",
}: {
  className?: string;
  placement?: "above" | "below";
}) {
  const legendId = useId();
  const controlRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (controlRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div className={`legend-control ${className}`.trim()} ref={controlRef}>
      <button
        aria-controls={open ? legendId : undefined}
        aria-expanded={open}
        className="secondary-button legend-button"
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        <Search size={18} aria-hidden="true" />
        <span>查看图例</span>
      </button>
      {open ? (
        <div
          className={`feedback-legend-tooltip feedback-legend-tooltip-${placement}`}
          id={legendId}
          role="tooltip"
        >
          <ul>
            {FEEDBACK_LEGEND_ITEMS.map((item) => (
              <li
                className={`feedback-legend-item feedback-legend-${item.status}`}
                key={item.status}
              >
                <span
                  className={`feedback-legend-icon feedback-${item.status}`}
                  aria-hidden="true"
                >
                  <b>
                    <FeedbackStatusIcon
                      decorative
                      size={14}
                      status={item.status}
                    />
                  </b>
                </span>
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
