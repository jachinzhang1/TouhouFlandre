import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Paper, type PaperTone } from "./Paper";
import { PaperButton } from "./PaperButton";

export function PaperSegmentGroup({
  children,
  className = "",
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <div
      className={`paper-segment-group ${className}`.trim()}
      role="group"
      aria-label={label}
    >
      {children}
    </div>
  );
}

export function PaperSegmentButton({
  active,
  ariaDescribedBy,
  ariaLabel,
  children,
  className = "",
  disabled = false,
  folded = false,
  pattern = false,
  onClick,
  tone = "default",
  title,
}: {
  active: boolean;
  ariaDescribedBy?: string;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  folded?: boolean;
  pattern?: boolean;
  children: ReactNode;
  onClick: () => void;
  title?: string;
  tone?: PaperTone;
}) {
  return (
    <Paper
      animateOnMount={false}
      ariaLabel={ariaLabel}
      ariaDescribedBy={ariaDescribedBy}
      ariaPressed={active}
      as="button"
      className={`paper-segment-button${active ? " active" : ""}${className ? ` ${className}` : ""}`}
      disabled={disabled}
      folded={folded}
      foldSize={12}
      onClick={onClick}
      pattern={pattern}
      sticker={false}
      title={title}
      unfoldOnHover={folded && active && !disabled}
      tone={active ? tone : "default"}
      variant={active ? "tinted" : "plain"}
    >
      {children}
    </Paper>
  );
}

export type PaperSegmentSeparatorOrientation =
  "vertical" | "horizontal" | "responsive";

export function PaperSegmentSeparator({
  orientation = "vertical",
}: {
  orientation?: PaperSegmentSeparatorOrientation;
}) {
  return (
    <span
      aria-hidden="true"
      className="paper-segment-separator"
      data-orientation={orientation}
    />
  );
}

export interface PaperPaginationProps {
  className?: string;
  controlsId?: string;
  counterLabel?: ReactNode;
  label: string;
  nextLabel?: string;
  onNext: () => void;
  onPrevious: () => void;
  page: number;
  pageCount: number;
  previousLabel?: string;
}

export function PaperPagination({
  className = "",
  controlsId,
  counterLabel,
  label,
  nextLabel = "下一页",
  onNext,
  onPrevious,
  page,
  pageCount,
  previousLabel = "上一页",
}: PaperPaginationProps) {
  const hasPrevious = page > 1;
  const hasNext = page < pageCount;
  return (
    <PaperSegmentGroup
      className={["paper-pagination", className].filter(Boolean).join(" ")}
      label={label}
    >
      <PaperButton
        ariaControls={controlsId}
        ariaLabel={previousLabel}
        disabled={!hasPrevious}
        filled={hasPrevious}
        folded={hasPrevious}
        iconOnly
        onClick={onPrevious}
        title={previousLabel}
        tone="theme"
      >
        <ChevronLeft size={20} aria-hidden="true" />
      </PaperButton>
      <PaperSegmentSeparator />
      <Paper
        animateOnMount={false}
        as="span"
        className="paper-pagination-counter"
        folded={false}
        sticker={false}
        unfoldOnHover={false}
        variant="plain"
      >
        <span aria-live="polite">
          {counterLabel ?? `${page} / ${Math.max(1, pageCount)}`}
        </span>
      </Paper>
      <PaperSegmentSeparator />
      <PaperButton
        ariaControls={controlsId}
        ariaLabel={nextLabel}
        disabled={!hasNext}
        filled={hasNext}
        folded={hasNext}
        iconOnly
        onClick={onNext}
        title={nextLabel}
        tone="theme"
      >
        <ChevronRight size={20} aria-hidden="true" />
      </PaperButton>
    </PaperSegmentGroup>
  );
}
