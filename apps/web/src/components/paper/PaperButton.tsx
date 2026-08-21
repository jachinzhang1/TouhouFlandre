import type { ReactNode } from "react";
import { Paper, type PaperTone } from "./Paper";

export type PaperButtonTone =
  "plain" | "theme" | Exclude<PaperTone, "default" | "contrast">;

export interface PaperButtonProps {
  ariaControls?: string;
  ariaLabel?: string;
  ariaPressed?: boolean;
  ariaExpanded?: boolean;
  children: ReactNode;
  className?: string;
  compact?: boolean;
  disabled?: boolean;
  filled?: boolean;
  folded?: boolean;
  iconOnly?: boolean;
  onClick: () => void;
  pattern?: boolean;
  title?: string;
  tone?: PaperButtonTone;
}

export function PaperButton({
  ariaControls,
  ariaLabel,
  ariaExpanded,
  ariaPressed,
  children,
  className = "",
  compact = false,
  disabled = false,
  filled = false,
  folded = true,
  iconOnly = false,
  onClick,
  pattern,
  title,
  tone = "plain",
}: PaperButtonProps) {
  const unavailable = disabled;
  const effectiveFilled = filled && !unavailable;
  const effectiveFolded = folded && !unavailable;
  const semanticTone = tone === "plain" || tone === "theme" ? "default" : tone;
  const surfaceTone = effectiveFilled ? semanticTone : "default";
  const effectivePattern = pattern ?? false;
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
      ariaControls={ariaControls}
      animateOnMount={false}
      ariaPressed={ariaPressed}
      ariaLabel={ariaLabel}
      ariaExpanded={ariaExpanded}
      as="button"
      className={classes}
      disabled={disabled}
      folded={effectiveFolded}
      foldSize={compact ? 8 : 10}
      onClick={onClick}
      pattern={effectivePattern}
      sticker={false}
      unfoldOnHover={!unavailable}
      title={title}
      tone={surfaceTone}
      variant={effectiveFilled ? "tinted" : "plain"}
    >
      {children}
    </Paper>
  );
}
