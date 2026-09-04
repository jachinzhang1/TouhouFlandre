import { ChevronDown } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";
import { Paper, type PaperVariant } from "./Paper";

export const PAPER_DATE_PICKER_CLASS_NAME = "paper-date-picker";
export const PAPER_DATE_PICKER_POPUP_CLASS_NAME = "paper-date-picker-dropdown";

export type PaperPickerProps = Omit<
  ComponentPropsWithoutRef<"select">,
  "className"
> & {
  className?: string;
  variant?: PaperVariant;
};

export function PaperPicker({
  children,
  className = "",
  variant = "plain",
  ...selectProps
}: PaperPickerProps) {
  return (
    <Paper
      animateOnMount={false}
      as="span"
      className={`paper-picker-control ${className}`.trim()}
      disabled={selectProps.disabled}
      folded={false}
      foldSize={10}
      sticker={false}
      shape="control"
      unfoldOnHover={false}
      variant={variant}
    >
      <select className="paper-picker-select" {...selectProps}>
        {children}
      </select>
      <ChevronDown
        className="paper-picker-chevron"
        size={16}
        aria-hidden="true"
      />
    </Paper>
  );
}
