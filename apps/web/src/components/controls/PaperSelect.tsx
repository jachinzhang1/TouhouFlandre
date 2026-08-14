import { ChevronDown } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";
import { Paper } from "../Paper";

type PaperSelectProps = Omit<
  ComponentPropsWithoutRef<"select">,
  "className"
> & {
  className?: string;
  compact?: boolean;
};

export function PaperSelect({
  children,
  className = "",
  compact = false,
  ...selectProps
}: PaperSelectProps) {
  return (
    <Paper
      animateOnMount={false}
      as="span"
      className={`paper-select-control${compact ? " paper-select-control-compact" : ""} ${className}`.trim()}
      foldSize={compact ? 8 : 10}
      sticker={false}
      unfoldOnHover={false}
      variant="plain"
    >
      <select className="paper-select-input" {...selectProps}>
        {children}
      </select>
      <ChevronDown
        className="paper-select-chevron"
        size={compact ? 14 : 16}
        aria-hidden="true"
      />
    </Paper>
  );
}
