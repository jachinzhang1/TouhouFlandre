"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type UIEventHandler,
} from "react";
import { Paper } from "./Paper";

export type PaperDataTableRowTone =
  "success" | "info" | "warning" | "danger" | "neutral";

interface PaperDataTableContextValue {
  bodyScrollRef: RefObject<HTMLDivElement | null>;
  headerScrollRef: RefObject<HTMLDivElement | null>;
  syncBodyScroll: UIEventHandler<HTMLDivElement>;
  syncHeaderScroll: UIEventHandler<HTMLDivElement>;
}

const PaperDataTableContext = createContext<PaperDataTableContextValue | null>(
  null,
);

function usePaperDataTable() {
  const context = useContext(PaperDataTableContext);
  if (!context) {
    throw new Error(
      "PaperDataTableHeader and PaperDataTableBody must be inside PaperDataTable.",
    );
  }
  return context;
}

function classNames(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}

function findStickyAncestor(element: HTMLElement) {
  let ancestor = element.parentElement;
  while (ancestor) {
    if (getComputedStyle(ancestor).position === "sticky") return ancestor;
    ancestor = ancestor.parentElement;
  }
  return null;
}

export function PaperDataTable({ children }: { children: ReactNode }) {
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const syncBodyScroll = useCallback<UIEventHandler<HTMLDivElement>>(
    (event) => {
      const body = bodyScrollRef.current;
      if (body && body.scrollLeft !== event.currentTarget.scrollLeft) {
        body.scrollLeft = event.currentTarget.scrollLeft;
      }
    },
    [],
  );
  const syncHeaderScroll = useCallback<UIEventHandler<HTMLDivElement>>(
    (event) => {
      const header = headerScrollRef.current;
      if (header && header.scrollLeft !== event.currentTarget.scrollLeft) {
        header.scrollLeft = event.currentTarget.scrollLeft;
      }
    },
    [],
  );
  const value = useMemo(
    () => ({
      bodyScrollRef,
      headerScrollRef,
      syncBodyScroll,
      syncHeaderScroll,
    }),
    [syncBodyScroll, syncHeaderScroll],
  );

  return (
    <PaperDataTableContext.Provider value={value}>
      {children}
    </PaperDataTableContext.Provider>
  );
}

export function PaperDataTableHeader({
  ariaLabel,
  children,
  className,
  visible = true,
}: {
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
  visible?: boolean;
}) {
  const { headerScrollRef, syncBodyScroll } = usePaperDataTable();
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const header = headerScrollRef.current;
    if (!header) return;
    const sticky = findStickyAncestor(header);
    if (!sticky) return;
    let animationFrame = 0;

    const update = () => {
      animationFrame = 0;
      const stickyTop = Number.parseFloat(getComputedStyle(sticky).top);
      const next =
        Number.isFinite(stickyTop) &&
        window.scrollY > 0 &&
        sticky.getBoundingClientRect().top <= stickyTop + 0.5;
      setStuck((current) => (current === next ? current : next));
      sticky.dataset.paperDataTableShadow = next ? "true" : "false";
    };

    const scheduleUpdate = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(update);
    };

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleUpdate);
    resizeObserver?.observe(header);
    resizeObserver?.observe(sticky);
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    update();

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      delete sticky.dataset.paperDataTableShadow;
    };
  }, [headerScrollRef, visible]);

  if (!visible) return null;

  return (
    <div
      aria-label={ariaLabel}
      role={ariaLabel ? "table" : undefined}
      className={classNames("paper-data-table-header-scroll", className)}
      data-shadow={stuck ? "true" : "false"}
      onScroll={syncBodyScroll}
      ref={headerScrollRef}
    >
      {children}
    </div>
  );
}

export function PaperDataTableBody({
  ariaLabel,
  children,
  className,
  responsiveStacked = false,
  viewportClassName,
}: {
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
  responsiveStacked?: boolean;
  viewportClassName?: string;
}) {
  const { bodyScrollRef, syncHeaderScroll } = usePaperDataTable();

  return (
    <Paper
      animateOnMount={false}
      as="div"
      className={classNames("paper-data-table", className)}
      folded={false}
      sticker={false}
      unfoldOnHover={false}
    >
      <div
        aria-label={ariaLabel}
        role={ariaLabel ? "table" : undefined}
        className={classNames(
          "paper-data-table-body-scroll",
          viewportClassName,
        )}
        data-paper-responsive-stacked={responsiveStacked ? "true" : undefined}
        onScroll={syncHeaderScroll}
        ref={bodyScrollRef}
      >
        {children}
      </div>
    </Paper>
  );
}

export function PaperDataTableDetail({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={classNames("paper-data-table-detail", className)}>
      {children}
    </div>
  );
}
