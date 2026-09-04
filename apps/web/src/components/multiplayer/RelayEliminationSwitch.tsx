"use client";

import { SettingSwitch } from "./SettingSwitch";

export function RelayEliminationSwitch({
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
  return (
    <SettingSwitch
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      description="仅当4人及以上可切换，打开时启用接力淘汰赛"
      className={className}
    />
  );
}
