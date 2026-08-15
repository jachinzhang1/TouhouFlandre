import { Search } from "lucide-react";
import type { InputHTMLAttributes, Ref } from "react";
import { Paper } from "../Paper";

export function PaperSearchInput({
  ariaLabel,
  className = "",
  containerRef,
  folded = true,
  ...inputProps
}: Omit<InputHTMLAttributes<HTMLInputElement>, "aria-label" | "className"> & {
  ariaLabel: string;
  className?: string;
  containerRef?: Ref<HTMLLabelElement>;
  folded?: boolean;
}) {
  return (
    <Paper
      as="div"
      className={`paper-search-control ${className}`.trim()}
      folded={folded}
      foldSize={12}
      sticker={false}
      variant="plain"
    >
      <label className="paper-search-control-inner" ref={containerRef}>
        <Search
          className="paper-search-control-icon"
          size={18}
          aria-hidden="true"
        />
        <input
          {...inputProps}
          aria-label={ariaLabel}
          className="paper-search-control-input"
        />
      </label>
    </Paper>
  );
}
