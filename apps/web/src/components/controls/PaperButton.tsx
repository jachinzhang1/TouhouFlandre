import type { ReactNode } from "react";
import { Paper } from "../Paper";

export type PaperButtonTone = "plain" | "theme" | "danger" | "jade";

export function PaperButton({
  ariaLabel,
  ariaDisabled = false,
  children,
  className = "",
  compact = false,
  disabled = false,
  filled = false,
  folded = true,
  iconOnly = false,
  onClick,
  title,
  tone = "plain",
}: {
  ariaLabel?: string;
  ariaDisabled?: boolean;
  children: ReactNode;
  className?: string;
  compact?: boolean;
  disabled?: boolean;
  filled?: boolean;
  folded?: boolean;
  iconOnly?: boolean;
  onClick: () => void;
  title?: string;
  tone?: PaperButtonTone;
}) {
  const unavailable = disabled || ariaDisabled;
  const effectiveFilled = filled && !unavailable;
  const effectiveFolded = folded && !unavailable;
  const classes = [
    "paper-button",
    `paper-button-${tone}`,
    compact ? "paper-button-compact" : "",
    effectiveFilled ? "paper-button-filled" : "",
    iconOnly ? "paper-button-icon" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Paper
      animateOnMount={false}
      ariaLabel={ariaLabel}
      ariaDisabled={ariaDisabled}
      as="button"
      className={classes}
      disabled={disabled}
      folded={effectiveFolded}
      foldSize={compact ? 8 : 10}
      onClick={ariaDisabled ? undefined : onClick}
      sticker={false}
      unfoldOnHover={!unavailable}
      title={title}
      variant={effectiveFilled ? "tinted" : "plain"}
    >
      {children}
    </Paper>
  );
}
