"use client";

import { Switch, Tooltip } from "antd";
import { useId } from "react";

export function RaceEliminationSwitch({
  checked,
  disabled,
  onChange,
  className = "",
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  const labelId = useId();
  const muted = Boolean(disabled);

  return (
    <div className={`flex items-center gap-2 ${className}`.trim()}>
      <span
        id={labelId}
        className={`text-[0.78rem] font-semibold ${
          muted ? "text-ink-soft" : "text-ink"
        }`}
      >
        淘汰
      </span>
      <Tooltip title="仅当3人及以上可切换，打开时开启淘汰赛">
        <span className="inline-flex">
          <Switch
            aria-labelledby={labelId}
            checked={checked}
            disabled={disabled}
            onChange={onChange}
            size="small"
          />
        </span>
      </Tooltip>
    </div>
  );
}
