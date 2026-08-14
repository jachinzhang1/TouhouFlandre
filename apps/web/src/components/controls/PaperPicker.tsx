import { ChevronDown } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";
import { Paper, type PaperVariant } from "../Paper";

type PaperPickerProps = Omit<
  ComponentPropsWithoutRef<"select">,
  "className"
> & {
  className?: string;
  variant?: PaperVariant;
};

export function PaperPicker({
  children,
  className = "",
  variant = "tinted",
  ...selectProps
}: PaperPickerProps) {
  return (
    <Paper
      animateOnMount={false}
      as="span"
      className={`paper-picker-control ${className}`.trim()}
      foldSize={10}
      sticker={false}
      unfoldOnHover
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
