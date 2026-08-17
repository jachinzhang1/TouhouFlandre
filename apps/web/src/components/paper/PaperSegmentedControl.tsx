import type { ReactNode } from "react";
import { Paper, type PaperTone } from "./Paper";

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
  folded = active,
  pattern = true,
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
