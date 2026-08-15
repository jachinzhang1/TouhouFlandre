"use client";

import { Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FeedbackStatus } from "@touhouflandre/shared";
import { FeedbackStatusIcon } from "./FeedbackStatusIcon";
import { Paper } from "../Paper";

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
  const [position, setPosition] = useState<{
    bottom?: number;
    left: number;
    top?: number;
    width: number;
  } | null>(null);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    const updatePosition = () => {
      const element = controlRef.current;
      if (!element) return;

      const rect = element.getBoundingClientRect();
      const margin = 18;
      const gap = 8;
      const width = Math.min(360, window.innerWidth - margin * 2);
      const left = Math.min(
        Math.max(margin, rect.right - width),
        window.innerWidth - width - margin,
      );

      setPosition({
        bottom:
          placement === "above"
            ? window.innerHeight - rect.top + gap
            : undefined,
        left,
        top: placement === "below" ? rect.bottom + gap : undefined,
        width,
      });
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (controlRef.current?.contains(target)) return;
      setOpen(false);
    };

    updatePosition();
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, placement]);

  return (
    <div className={`legend-control ${className}`.trim()} ref={controlRef}>
      <Paper
        animateOnMount={false}
        ariaControls={open ? legendId : undefined}
        ariaExpanded={open}
        as="button"
        className="paper-button paper-button-plain legend-button"
        foldSize={10}
        onClick={() => setOpen((value) => !value)}
        sticker={false}
        variant="plain"
      >
        <Search size={18} aria-hidden="true" />
        <span>查看图例</span>
      </Paper>
      {open && position
        ? createPortal(
            <div
              className={`feedback-legend-tooltip feedback-legend-tooltip-${placement}`}
              id={legendId}
              role="tooltip"
              style={position}
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
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
