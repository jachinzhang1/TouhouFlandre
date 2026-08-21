import type { InputHTMLAttributes, Ref } from "react";
import { Paper } from "./Paper";

export function PaperTextInput({
  ariaLabel,
  className = "",
  disabled = false,
  folded = false,
  inputClassName = "",
  inputRef,
  ...inputProps
}: Omit<InputHTMLAttributes<HTMLInputElement>, "aria-label" | "className"> & {
  ariaLabel: string;
  className?: string;
  folded?: boolean;
  inputClassName?: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <Paper
      animateOnMount={false}
      as="div"
      folded={folded}
      className={["paper-text-control", className].filter(Boolean).join(" ")}
      disabled={disabled}
      foldSize={10}
      sticker={false}
      variant="plain"
    >
      <input
        {...inputProps}
        ref={inputRef}
        aria-label={ariaLabel}
        className={["paper-text-input", inputClassName]
          .filter(Boolean)
          .join(" ")}
        disabled={disabled}
      />
    </Paper>
  );
}
