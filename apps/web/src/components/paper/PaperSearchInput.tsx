import { Search } from "lucide-react";
import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import { Paper } from "./Paper";

export function PaperSearchInput({
  ariaLabel,
  className = "",
  containerRef,
  disabled = false,
  endAdornment,
  inputRef,
  folded = false,
  ...inputProps
}: Omit<InputHTMLAttributes<HTMLInputElement>, "aria-label" | "className"> & {
  ariaLabel: string;
  className?: string;
  containerRef?: Ref<HTMLLabelElement>;
  inputRef?: Ref<HTMLInputElement>;
  endAdornment?: ReactNode;
  folded?: boolean;
}) {
  return (
    <Paper
      as="div"
      className={`paper-search-control ${className}`.trim()}
      disabled={disabled}
      folded={folded}
      foldSize={12}
      pattern={false}
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
          ref={inputRef}
          {...inputProps}
          aria-label={ariaLabel}
          className="paper-search-control-input"
          disabled={disabled}
        />
      </label>
      {endAdornment ? (
        <span className="paper-search-control-adornment">{endAdornment}</span>
      ) : null}
    </Paper>
  );
}
