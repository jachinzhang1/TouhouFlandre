import { Search } from "lucide-react";
import type { ChangeEventHandler } from "react";
import { Paper } from "../Paper";

export function PaperSearchInput({
  ariaLabel,
  onChange,
  placeholder,
  value,
}: {
  ariaLabel: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  placeholder: string;
  value: string;
}) {
  return (
    <Paper
      as="div"
      className="paper-search-control"
      foldSize={12}
      sticker={false}
      variant="plain"
    >
      <label className="paper-search-control-inner">
        <Search
          className="paper-search-control-icon"
          size={18}
          aria-hidden="true"
        />
        <input
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className="paper-search-control-input"
        />
      </label>
    </Paper>
  );
}
