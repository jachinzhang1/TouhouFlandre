import Link from "next/link";
import type {
  AriaRole,
  CSSProperties,
  MouseEventHandler,
  ReactNode,
} from "react";

export type PaperVariant = "plain" | "tinted";

interface PaperProps {
  ariaLabel?: string;
  ariaPressed?: boolean;
  animateOnMount?: boolean;
  as?: "article" | "button" | "div" | "span";
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  folded?: boolean;
  foldSize?: number;
  href?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  foldDelayMs?: number;
  role?: AriaRole;
  stackOrder?: number;
  sticker?: boolean;
  unfoldOnHover?: boolean;
  unfolded?: boolean;
  ariaHidden?: boolean;
  title?: string;
  variant?: PaperVariant;
}

export function Paper({
  ariaLabel,
  ariaPressed,
  animateOnMount = true,
  as = "span",
  children,
  className = "",
  disabled,
  folded = true,
  foldSize = 12,
  href,
  onClick,
  foldDelayMs = 0,
  role,
  stackOrder,
  sticker = true,
  unfoldOnHover = true,
  unfolded = false,
  ariaHidden,
  title,
  variant = "plain",
}: PaperProps) {
  const paperClassName = ["paper-surface", className].filter(Boolean).join(" ");
  const paperStyle = {
    "--paper-fold-delay": `${Math.max(0, foldDelayMs)}ms`,
    "--paper-fold-size": `${Math.max(0, foldSize)}px`,
  } as CSSProperties;
  const paperProps = {
    className: paperClassName,
    "data-paper-variant": variant,
    "data-paper-folded": folded ? "true" : "false",
    "data-paper-unfold-hover": unfoldOnHover ? "true" : "false",
    "data-paper-animate-mount": animateOnMount ? "true" : "false",
    style: paperStyle,
    "data-paper-unfolded": unfolded ? "true" : undefined,
    "aria-hidden": ariaHidden || undefined,
    "aria-label": ariaLabel,
    "aria-pressed": ariaPressed,
    role,
    title,
  } as const;

  let surface: ReactNode;
  if (href) {
    surface = (
      <Link href={href} {...paperProps}>
        {children}
      </Link>
    );
  } else if (as === "button") {
    surface = (
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
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

  return (
    <div
      className="paper-sticker"
      data-paper-sticker="true"
      style={stackOrder === undefined ? undefined : { zIndex: stackOrder }}
    >
      <span className="paper-sticker-cast" aria-hidden="true">
        <span className="paper-sticker-soft-blur" />
      </span>
      {surface}
    </div>
  );
}
