import Link from "next/link";
import type {
  AriaRole,
  CSSProperties,
  MouseEventHandler,
  ReactNode,
  Ref,
} from "react";

export type PaperVariant = "plain" | "tinted";
export type PaperTone =
  | "default"
  | "success"
  | "info"
  | "warning"
  | "danger"
  | "neutral"
  | "contrast";

export type PaperElevation = "none" | "sm" | "lg" | "accent";
export type PaperShape = "note" | "control" | "corner";

export interface PaperProps {
  ariaLabel?: string;
  ariaChecked?: boolean | "mixed";
  ariaDescribedBy?: string;
  ariaControls?: string;
  ariaDisabled?: boolean;
  ariaExpanded?: boolean;
  ariaPressed?: boolean;
  animateOnMount?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  as?: "article" | "button" | "div" | "span";
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  elevation?: PaperElevation;
  folded?: boolean;
  foldSize?: number;
  href?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  foldDelayMs?: number;
  pattern?: boolean;
  preserveAppearanceWhenDisabled?: boolean;
  shape?: PaperShape;
  role?: AriaRole;
  stackOrder?: number;
  sticker?: boolean;
  unfoldOnHover?: boolean;
  unfolded?: boolean;
  ariaHidden?: boolean;
  tone?: PaperTone;
  title?: string;
  variant?: PaperVariant;
}

export function Paper({
  ariaControls,
  ariaChecked,
  ariaDescribedBy,
  ariaLabel,
  ariaDisabled,
  ariaExpanded,
  ariaPressed,
  animateOnMount = true,
  buttonRef,
  as = "span",
  children,
  className = "",
  disabled,
  elevation = "none",
  folded = true,
  foldSize = 12,
  href,
  onClick,
  foldDelayMs = 0,
  pattern = false,
  preserveAppearanceWhenDisabled = false,
  shape,
  role,
  stackOrder,
  sticker = true,
  unfoldOnHover = true,
  unfolded = false,
  ariaHidden,
  tone = "default",
  title,
  variant = "plain",
}: PaperProps) {
  const disabledAppearance = disabled === true || ariaDisabled === true;
  const muteDisabledAppearance =
    disabledAppearance && !preserveAppearanceWhenDisabled;
  const effectiveShape = shape ?? (as === "button" ? "control" : "note");
  const effectiveFolded =
    effectiveShape === "note" && folded && !muteDisabledAppearance;
  const effectiveUnfoldOnHover =
    effectiveShape === "note" && unfoldOnHover && !disabledAppearance;
  const effectiveVariant = muteDisabledAppearance ? "plain" : variant;
  const paperClassName = ["paper-surface", className].filter(Boolean).join(" ");
  const paperStyle = {
    "--paper-fold-delay": `${Math.max(0, foldDelayMs)}ms`,
    "--paper-fold-size": `${Math.max(0, foldSize)}px`,
  } as CSSProperties;
  const paperProps = {
    className: paperClassName,
    "data-paper-variant": effectiveVariant,
    "data-paper-pattern": pattern ? "default" : "none",
    "data-paper-shape": effectiveShape,
    "data-paper-tone": tone,
    "data-paper-elevation": elevation,
    "data-paper-folded": effectiveFolded ? "true" : "false",
    "data-paper-unfold-hover": effectiveUnfoldOnHover ? "true" : "false",
    "data-paper-disabled": disabledAppearance ? "true" : undefined,
    "data-paper-preserve-appearance":
      disabledAppearance && preserveAppearanceWhenDisabled ? "true" : undefined,
    "data-paper-animate-mount": animateOnMount ? "true" : "false",
    style: paperStyle,
    "data-paper-unfolded": unfolded && !disabledAppearance ? "true" : undefined,
    "aria-hidden": ariaHidden || undefined,
    "aria-label": ariaLabel,
    "aria-controls": ariaControls,
    "aria-checked": ariaChecked,
    "aria-describedby": ariaDescribedBy,
    "aria-expanded": ariaExpanded,
    "aria-disabled": disabledAppearance || undefined,
    "aria-pressed": ariaPressed,
    role,
    title,
  } as const;

  let surface: ReactNode;
  if (href && !disabledAppearance) {
    surface = (
      <Link href={href} {...paperProps}>
        {children}
      </Link>
    );
  } else if (href) {
    surface = (
      <span {...paperProps} role={role ?? "link"}>
        {children}
      </span>
    );
  } else if (as === "button") {
    surface = (
      <button
        ref={buttonRef}
        type="button"
        disabled={disabledAppearance}
        onClick={disabledAppearance ? undefined : onClick}
        {...paperProps}
      >
        {children}
      </button>
    );
  } else if (as === "article") {
    surface = <article {...paperProps}>{children}</article>;
  } else if (as === "div") {
    surface = <div {...paperProps}>{children}</div>;
  } else {
    surface = <span {...paperProps}>{children}</span>;
  }

  if (!sticker) return surface;

  return <PaperSticker stackOrder={stackOrder}>{surface}</PaperSticker>;
}

export function PaperSticker({
  children,
  className = "",
  stackOrder,
}: {
  children: ReactNode;
  className?: string;
  stackOrder?: number;
}) {
  return (
    <div
      className={["paper-sticker", className].filter(Boolean).join(" ")}
      data-paper-sticker="true"
      style={stackOrder === undefined ? undefined : { zIndex: stackOrder }}
    >
      <span className="paper-sticker-cast" aria-hidden="true">
        <span className="paper-sticker-soft-blur" />
      </span>
      {children}
    </div>
  );
}
