"use client";

import { Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Paper, PaperButton } from "@/components/paper";
import { FeedbackStatusIcon } from "./FeedbackStatusIcon";
import { FEEDBACK_LEGEND_ITEMS } from "./FeedbackLegend";

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
      <PaperButton
        ariaControls={open ? legendId : undefined}
        ariaExpanded={open}
        ariaLabel="查看反馈图例"
        className="legend-button"
        folded={false}
        iconOnly
        onClick={() => setOpen((value) => !value)}
        title="查看反馈图例"
      >
        <Search size={18} aria-hidden="true" />
      </PaperButton>
      {open && position
        ? createPortal(
            <div
              className={`feedback-legend-tooltip-positioner feedback-legend-tooltip-${placement}`}
              id={legendId}
              role="tooltip"
              style={position}
            >
              <Paper
                animateOnMount={false}
                as="div"
                className="feedback-legend-tooltip"
                elevation="lg"
                folded={false}
                pattern={false}
                sticker={false}
                unfoldOnHover={false}
              >
                <ul>
                  {FEEDBACK_LEGEND_ITEMS.map((item) => (
                    <li
                      className={`feedback-legend-item feedback-legend-${item.status}`}
                      key={item.status}
                    >
                      <span
                        className={`feedback-legend-icon feedback-legend-icon-${item.status}`}
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
              </Paper>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
