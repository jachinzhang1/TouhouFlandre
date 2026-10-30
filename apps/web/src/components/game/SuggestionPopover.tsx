"use client";

import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Paper } from "@/components/paper";

export function SuggestionPopover({
  anchor,
  children,
  id,
  open,
}: {
  anchor: RefObject<HTMLLabelElement | null>;
  children: ReactNode;
  id: string;
  open: boolean;
}) {
  const [position, setPosition] = useState<{
    bottom?: number;
    left: number;
    maxHeight: number;
    top?: number;
    width: number;
  } | null>(null);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    const updatePosition = () => {
      const element = anchor.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const margin = 12;
      const gap = 7;
      const width = Math.min(640, rect.width, window.innerWidth - margin * 2);
      const left = Math.min(
        Math.max(margin, rect.left),
        window.innerWidth - width - margin,
      );
      const spaceBelow = window.innerHeight - rect.bottom - gap - margin;
      const spaceAbove = rect.top - gap - margin;
      const placeBelow = spaceBelow >= 220 || spaceBelow >= spaceAbove;
      const availableSpace = placeBelow ? spaceBelow : spaceAbove;

      setPosition({
        bottom: placeBelow ? undefined : window.innerHeight - rect.top + gap,
        left,
        maxHeight: Math.max(80, Math.min(320, availableSpace)),
        top: placeBelow ? rect.bottom + gap : undefined,
        width,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchor, open]);

  if (!open || !position) return null;
  return createPortal(
    <div
      className="suggestion-list-positioner"
      id={id}
      role="listbox"
      aria-label="搜索建议"
      style={position}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Paper
        animateOnMount={false}
        as="div"
        className="suggestion-list paper-data-table"
        elevation="lg"
        folded={false}
        sticker={false}
        unfoldOnHover={false}
        variant="plain"
      >
        <div className="suggestion-list-body paper-data-table-body">
          {children}
        </div>
      </Paper>
    </div>,
    document.body,
  );
}
