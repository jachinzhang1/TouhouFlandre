import type { ReactNode } from "react";
import { Paper } from "./Paper";

export function PaperRadioGroup({
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
      aria-label={label}
      className={["paper-radio-group", className].filter(Boolean).join(" ")}
      role="radiogroup"
    >
      {children}
    </div>
  );
}

export function PaperRadioOption({
  ariaDescribedBy,
  checked,
  children,
  className = "",
  disabled = false,
  onSelect,
}: {
  ariaDescribedBy?: string;
  checked: boolean;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <Paper
      animateOnMount={false}
      ariaChecked={checked}
      ariaDescribedBy={ariaDescribedBy}
      as="button"
      className={["paper-radio-option", className].filter(Boolean).join(" ")}
      disabled={disabled}
      folded={checked}
      foldSize={10}
      onClick={onSelect}
      role="radio"
      sticker={false}
      unfoldOnHover={checked && !disabled}
      variant={checked ? "tinted" : "plain"}
    >
      {children}
    </Paper>
  );
}
