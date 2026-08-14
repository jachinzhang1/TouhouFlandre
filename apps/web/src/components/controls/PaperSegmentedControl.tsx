import type { ReactNode } from "react";
import { Paper } from "../Paper";

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
  ariaLabel,
  children,
  onClick,
  title,
}: {
  active: boolean;
  ariaLabel?: string;
  children: ReactNode;
  onClick: () => void;
  title?: string;
}) {
  return (
    <Paper
      animateOnMount={false}
      ariaLabel={ariaLabel}
      ariaPressed={active}
      as="button"
      className={`paper-segment-button${active ? " active" : ""}`}
      folded={active}
      foldSize={12}
      onClick={onClick}
      sticker={false}
      title={title}
      unfoldOnHover={active}
      variant={active ? "tinted" : "plain"}
    >
      {children}
    </Paper>
  );
}

export function PaperSegmentSeparator() {
  return <span className="paper-segment-separator" aria-hidden="true" />;
}
