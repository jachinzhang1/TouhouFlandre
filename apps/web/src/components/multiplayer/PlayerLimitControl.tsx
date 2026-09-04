"use client";

export interface PlayerLimitControlProps {
  id: string;
  label?: string;
  ariaLabel?: string;
  value: number;
  allowedValues: readonly number[];
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  className?: string;
}

export function PlayerLimitControl({
  id,
  label = "玩家上限",
  ariaLabel,
  value,
  allowedValues,
  min,
  max,
  step,
  disabled = false,
  onChange,
  className = "",
}: PlayerLimitControlProps) {
  const normalize = (candidate: number) => {
    const bounded = Math.min(max, Math.max(min, candidate));
    return allowedValues.reduce((closest, option) =>
      Math.abs(option - bounded) < Math.abs(closest - bounded)
        ? option
        : closest,
    );
  };

  return (
    <label
      className={`min-w-0 flex-1 text-[0.78rem] text-ink-soft ${className}`.trim()}
      htmlFor={id}
    >
      <span className="mb-1 flex items-center justify-between gap-2">
        <span>{label}</span>
        <output
          htmlFor={id}
          className="font-bold tabular-nums text-ink"
          aria-live="polite"
        >
          {value} 人
        </output>
      </span>
      <input
        id={id}
        aria-label={ariaLabel ?? label}
        aria-valuetext={`${value} 人`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) =>
          onChange(normalize(Number(event.target.value) || min))
        }
        className="block w-full accent-vermilion focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vermilion"
      />
    </label>
  );
}
