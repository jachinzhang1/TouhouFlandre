"use client";

import {
  useCallback,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import {
  resolvePanelPlacement,
  type FloatingBounds,
} from "../lib/floatingControls";

export type AnchoredFloatingPanelResult = {
  panelStyle: CSSProperties;
  vertical: "above" | "below";
  horizontal: "left" | "right";
};

export function useAnchoredFloatingPanel({
  boundaryRef,
  anchorRef,
  panelRef,
  maximumNaturalHeight,
  gap = 10,
  positionKey,
}: {
  boundaryRef: RefObject<HTMLElement | null>;
  anchorRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLElement | null>;
  maximumNaturalHeight?: number;
  gap?: number;
  positionKey?: unknown;
}): AnchoredFloatingPanelResult {
  const [result, setResult] = useState<AnchoredFloatingPanelResult>({
    panelStyle: {},
    vertical: "below",
    horizontal: "right",
  });

  const recalculate = useCallback(() => {
    const boundary = boundaryRef.current;
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!boundary || !anchor || !panel) return;
    const boundaryRect = boundary.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const bounds: FloatingBounds = {
      left: boundaryRect.left,
      top: boundaryRect.top,
      right: boundaryRect.right,
      bottom: boundaryRect.bottom,
    };
    const naturalHeight = Math.max(
      panelRect.height,
      panel.offsetHeight,
      panel.scrollHeight,
    );
    const placement = resolvePanelPlacement(
      {
        left: anchorRect.left,
        top: anchorRect.top,
        right: anchorRect.right,
        bottom: anchorRect.bottom,
      },
      {
        width: Math.max(panelRect.width, panel.offsetWidth, panel.scrollWidth),
        height:
          maximumNaturalHeight === undefined
            ? naturalHeight
            : Math.min(maximumNaturalHeight, naturalHeight),
      },
      bounds,
      gap,
    );
    const panelStyle = {
      left: `${placement.left}px`,
      top: `${placement.top}px`,
      maxWidth: `${placement.maxWidth}px`,
      maxHeight: `${placement.maxHeight}px`,
      transformOrigin: `${placement.vertical === "below" ? "top" : "bottom"} ${
        placement.horizontal === "left" ? "left" : "right"
      }`,
    };
    setResult((current) =>
      current.vertical === placement.vertical &&
      current.horizontal === placement.horizontal &&
      current.panelStyle.left === panelStyle.left &&
      current.panelStyle.top === panelStyle.top &&
      current.panelStyle.maxWidth === panelStyle.maxWidth &&
      current.panelStyle.maxHeight === panelStyle.maxHeight &&
      current.panelStyle.transformOrigin === panelStyle.transformOrigin
        ? current
        : {
            vertical: placement.vertical,
            horizontal: placement.horizontal,
            panelStyle,
          },
    );
  }, [anchorRef, boundaryRef, gap, maximumNaturalHeight, panelRef]);

  useLayoutEffect(() => {
    recalculate();
  }, [positionKey, recalculate]);

  useLayoutEffect(() => {
    const boundary = boundaryRef.current;
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(recalculate);
    if (boundary) resizeObserver?.observe(boundary);
    if (anchor) resizeObserver?.observe(anchor);
    if (panel) resizeObserver?.observe(panel);
    window.addEventListener("resize", recalculate);
    window.visualViewport?.addEventListener("resize", recalculate);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", recalculate);
      window.visualViewport?.removeEventListener("resize", recalculate);
    };
  }, [anchorRef, boundaryRef, panelRef, recalculate]);

  return result;
}
