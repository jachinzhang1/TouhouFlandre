"use client";

import { Switch, Tooltip } from "antd";
import { useId } from "react";

export function SettingSwitch({
  checked,
  disabled,
  onChange,
  label = "淘汰",
  description,
  className = "",
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  className?: string;
}) {
  const labelId = useId();
  const descriptionId = useId();
  const muted = Boolean(disabled);

  const control = (
    <Switch
      aria-labelledby={labelId}
      {...(description ? { "aria-describedby": descriptionId } : {})}
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      size="small"
    />
  );

  return (
    <div className={`flex items-center gap-2 ${className}`.trim()}>
      <span
        id={labelId}
        className={`text-[0.78rem] font-semibold ${
          muted ? "text-ink-soft" : "text-ink"
        }`}
      >
        {label}
      </span>
      {description ? (
        <Tooltip title={description}>
          <span className="inline-flex">
            <span id={descriptionId} className="sr-only">
              {description}
            </span>
            {control}
          </span>
        </Tooltip>
      ) : (
        control
      )}
    </div>
  );
}
