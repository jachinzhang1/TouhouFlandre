"use client";

import { SettingSwitch } from "./SettingSwitch";

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
  return (
    <SettingSwitch
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      description="仅当3人及以上可切换，打开时开启竞速淘汰赛"
      className={className}
    />
  );
}
