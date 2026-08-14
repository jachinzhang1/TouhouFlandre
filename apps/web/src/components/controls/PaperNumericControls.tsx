"use client";

import type { CSSProperties, ReactNode } from "react";
import { Paper } from "../Paper";

export function PaperSwitch({
  ariaLabel,
  checked,
  disabled = false,
  onChange,
}: {
  ariaLabel: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Paper
      animateOnMount={false}
      ariaChecked={checked}
      ariaLabel={ariaLabel}
      as="button"
      className="paper-switch-control"
      disabled={disabled}
      folded={false}
      foldSize={7}
      onClick={() => onChange(!checked)}
      role="switch"
      sticker={false}
      unfoldOnHover={false}
      variant={checked && !disabled ? "tinted" : "plain"}
    >
      <span className="paper-switch-track" aria-hidden="true">
        <span className="paper-switch-thumb" />
      </span>
    </Paper>
  );
}

export function PaperRange({
  ariaLabel,
  disabled = false,
  max,
  min,
  onChange,
  value,
}: {
  ariaLabel: string;
  disabled?: boolean;
  max: number;
  min: number;
  onChange: (value: number) => void;
  value: number;
}) {
  const progress = max === min ? 0 : ((value - min) / (max - min)) * 100;
  const style = {
    "--paper-range-progress": `${Math.max(0, Math.min(100, progress))}%`,
  } as CSSProperties;

  return (
    <Paper
      animateOnMount={false}
      as="span"
      className="paper-range-control"
      folded={false}
      sticker={false}
      unfoldOnHover={false}
      variant="plain"
    >
      <input
        aria-label={ariaLabel}
        className="paper-range-input"
        disabled={disabled}
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        style={style}
        type="range"
        value={value}
      />
    </Paper>
  );
}

export function PaperNumberInput({
  ariaLabel,
  disabled = false,
  max,
  min,
  onChange,
  suffix,
  value,
}: {
  ariaLabel: string;
  disabled?: boolean;
  max: number;
  min: number;
  onChange: (value: number) => void;
  suffix: ReactNode;
  value: number;
}) {
  return (
    <Paper
      animateOnMount={false}
      as="span"
      className="paper-number-control"
      folded={false}
      sticker={false}
      unfoldOnHover={false}
      variant="plain"
    >
      <input
        aria-label={ariaLabel}
        className="paper-number-input"
        disabled={disabled}
        max={max}
        min={min}
        onChange={(event) => {
          const next = event.target.valueAsNumber;
          if (Number.isFinite(next)) onChange(next);
        }}
        type="number"
        value={value}
      />
      <span className="paper-number-suffix" aria-hidden="true">
        {suffix}
      </span>
    </Paper>
  );
}
