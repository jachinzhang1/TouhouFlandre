"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  clampPosition,
  denormalizePosition,
  loadFloatingControlPositions,
  normalizePosition,
  saveFloatingControlPosition,
  type FloatingBounds,
  type FloatingControlId,
  type FloatingPoint,
  type FloatingSize,
} from "../lib/floatingControls";

const DRAG_THRESHOLD = 5;

type DragState = {
  pointerId: number;
  startPointer: FloatingPoint;
  startPosition: FloatingPoint;
  bounds: FloatingBounds;
  controlSize: FloatingSize;
  crossedThreshold: boolean;
};

export type FloatingDragHandleProps = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
};

export type DraggableFloatingControlResult = {
  positionStyle: CSSProperties;
  isDragging: boolean;
  dragHandleProps: FloatingDragHandleProps;
};

export type DraggableFloatingControlOptions = {
  controlId: FloatingControlId;
  boundaryRef: RefObject<HTMLElement | null>;
  floatingRef: RefObject<HTMLElement | null>;
  handleRef: RefObject<HTMLElement | null>;
  getDefaultPosition: (
    bounds: FloatingBounds,
    controlSize: FloatingSize,
  ) => FloatingPoint;
};

function localBounds(element: HTMLElement): FloatingBounds {
  return {
    left: 0,
    top: 0,
    right: element.clientWidth,
    bottom: element.clientHeight,
  };
}

function elementSize(element: HTMLElement): FloatingSize {
  const rect = element.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

function requestFrame(callback: FrameRequestCallback): number {
  if (typeof window.requestAnimationFrame === "function") {
    return window.requestAnimationFrame(callback);
  }
  return window.setTimeout(() => callback(performance.now()), 16);
}

function cancelFrame(frame: number): void {
  if (typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(frame);
    return;
  }
  window.clearTimeout(frame);
}

export function useDraggableFloatingControl({
  controlId,
  boundaryRef,
  floatingRef,
  handleRef,
  getDefaultPosition,
}: DraggableFloatingControlOptions): DraggableFloatingControlResult {
  const [position, setPosition] = useState<FloatingPoint | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const positionRef = useRef<FloatingPoint | null>(null);
  const normalizedPositionRef = useRef<ReturnType<
    typeof normalizePosition
  > | null>(null);
  const hasCustomPositionRef = useRef(false);
  const initializedRef = useRef(false);
  const dragRef = useRef<DragState | null>(null);
  const pendingFrameRef = useRef<number | null>(null);
  const pendingPositionRef = useRef<FloatingPoint | null>(null);
  const suppressNextClickRef = useRef(false);
  const suppressResetTimerRef = useRef<number | null>(null);
  const getDefaultPositionRef = useRef(getDefaultPosition);
  getDefaultPositionRef.current = getDefaultPosition;

  const applyPosition = useCallback((nextPosition: FloatingPoint) => {
    positionRef.current = nextPosition;
    setPosition((currentPosition) =>
      currentPosition?.x === nextPosition.x &&
      currentPosition.y === nextPosition.y
        ? currentPosition
        : nextPosition,
    );
  }, []);

  const recalculatePosition = useCallback(() => {
    if (dragRef.current) return;
    const boundary = boundaryRef.current;
    const handle = handleRef.current;
    if (!boundary || !handle) return;
    const bounds = localBounds(boundary);
    const size = elementSize(handle);

    if (!initializedRef.current) {
      const loaded = loadFloatingControlPositions();
      const storedPosition = loaded.positions[controlId];
      if (storedPosition) {
        normalizedPositionRef.current = storedPosition;
        hasCustomPositionRef.current = true;
      }
      initializedRef.current = true;
    }

    const nextPosition =
      hasCustomPositionRef.current && normalizedPositionRef.current
        ? denormalizePosition(normalizedPositionRef.current, size, bounds)
        : clampPosition(
            getDefaultPositionRef.current(bounds, size),
            size,
            bounds,
          );
    applyPosition(nextPosition);
  }, [applyPosition, boundaryRef, controlId, handleRef]);

  useLayoutEffect(() => {
    recalculatePosition();
    const boundary = boundaryRef.current;
    const handle = handleRef.current;
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(recalculatePosition);
    if (boundary) resizeObserver?.observe(boundary);
    if (handle) resizeObserver?.observe(handle);
    window.addEventListener("resize", recalculatePosition);
    window.visualViewport?.addEventListener("resize", recalculatePosition);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", recalculatePosition);
      window.visualViewport?.removeEventListener("resize", recalculatePosition);
    };
  }, [boundaryRef, handleRef, recalculatePosition]);

  useLayoutEffect(
    () => () => {
      if (pendingFrameRef.current !== null) {
        cancelFrame(pendingFrameRef.current);
      }
      if (suppressResetTimerRef.current !== null) {
        window.clearTimeout(suppressResetTimerRef.current);
      }
    },
    [],
  );

  const flushPendingPosition = useCallback(() => {
    if (pendingFrameRef.current !== null) {
      cancelFrame(pendingFrameRef.current);
      pendingFrameRef.current = null;
    }
    const pending = pendingPositionRef.current;
    pendingPositionRef.current = null;
    if (pending) applyPosition(pending);
    return pending;
  }, [applyPosition]);

  const schedulePosition = useCallback(
    (nextPosition: FloatingPoint) => {
      pendingPositionRef.current = nextPosition;
      if (pendingFrameRef.current !== null) return;
      pendingFrameRef.current = requestFrame(() => {
        pendingFrameRef.current = null;
        const pending = pendingPositionRef.current;
        pendingPositionRef.current = null;
        if (pending) applyPosition(pending);
      });
    },
    [applyPosition],
  );

  const positionFromPointer = useCallback(
    (event: ReactPointerEvent<HTMLElement>, drag: DragState) =>
      clampPosition(
        {
          x: drag.startPosition.x + event.clientX - drag.startPointer.x,
          y: drag.startPosition.y + event.clientY - drag.startPointer.y,
        },
        drag.controlSize,
        drag.bounds,
      ),
    [],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!event.isPrimary || event.button !== 0) return;
      const boundary = boundaryRef.current;
      const floating = floatingRef.current;
      const handle = handleRef.current;
      if (!boundary || !floating || !handle) return;
      const boundaryRect = boundary.getBoundingClientRect();
      const floatingRect = floating.getBoundingClientRect();
      const bounds = localBounds(boundary);
      const controlSize = elementSize(handle);
      const startPosition = clampPosition(
        positionRef.current ?? {
          x: floatingRect.left - boundaryRect.left,
          y: floatingRect.top - boundaryRect.top,
        },
        controlSize,
        bounds,
      );
      dragRef.current = {
        pointerId: event.pointerId,
        startPointer: { x: event.clientX, y: event.clientY },
        startPosition,
        bounds,
        controlSize,
        crossedThreshold: false,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [boundaryRef, floatingRef, handleRef],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const distance = Math.hypot(
        event.clientX - drag.startPointer.x,
        event.clientY - drag.startPointer.y,
      );
      if (!drag.crossedThreshold && distance <= DRAG_THRESHOLD) return;
      if (!drag.crossedThreshold) {
        drag.crossedThreshold = true;
        setIsDragging(true);
      }
      event.preventDefault();
      schedulePosition(positionFromPointer(event, drag));
    },
    [positionFromPointer, schedulePosition],
  );

  const resetClickSuppression = useCallback(() => {
    if (suppressResetTimerRef.current !== null) {
      window.clearTimeout(suppressResetTimerRef.current);
    }
    suppressResetTimerRef.current = window.setTimeout(() => {
      suppressNextClickRef.current = false;
      suppressResetTimerRef.current = null;
    }, 0);
  }, []);

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      if (drag.crossedThreshold) {
        const finalPosition = positionFromPointer(event, drag);
        pendingPositionRef.current = finalPosition;
        flushPendingPosition();
        const normalized = normalizePosition(
          finalPosition,
          drag.controlSize,
          drag.bounds,
        );
        normalizedPositionRef.current = normalized;
        hasCustomPositionRef.current = true;
        saveFloatingControlPosition(controlId, normalized);
        suppressNextClickRef.current = true;
        resetClickSuppression();
      }
      setIsDragging(false);
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [
      controlId,
      flushPendingPosition,
      positionFromPointer,
      resetClickSuppression,
    ],
  );

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      pendingPositionRef.current = null;
      if (pendingFrameRef.current !== null) {
        cancelFrame(pendingFrameRef.current);
        pendingFrameRef.current = null;
      }
      applyPosition(drag.startPosition);
      if (drag.crossedThreshold) {
        suppressNextClickRef.current = true;
        resetClickSuppression();
      }
      setIsDragging(false);
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [applyPosition, resetClickSuppression],
  );

  const handleClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!suppressNextClickRef.current) return;
      suppressNextClickRef.current = false;
      if (suppressResetTimerRef.current !== null) {
        window.clearTimeout(suppressResetTimerRef.current);
        suppressResetTimerRef.current = null;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [],
  );

  return {
    positionStyle: position
      ? { left: `${position.x}px`, top: `${position.y}px` }
      : {},
    isDragging,
    dragHandleProps: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
      onClickCapture: handleClickCapture,
    },
  };
}
