import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

export type PaperVariant = "plain" | "tinted";

interface PaperProps {
  animateOnMount?: boolean;
  as?: "article" | "div" | "span";
  children?: ReactNode;
  className?: string;
  folded?: boolean;
  foldSize?: number;
  href?: string;
  foldDelayMs?: number;
  unfoldOnHover?: boolean;
  unfolded?: boolean;
  ariaHidden?: boolean;
  variant?: PaperVariant;
}

export function Paper({
  animateOnMount = true,
  as = "span",
  children,
  className = "",
  folded = true,
  foldSize = 12,
  href,
  foldDelayMs = 0,
  unfoldOnHover = true,
  unfolded = false,
  ariaHidden,
  variant = "plain",
}: PaperProps) {
  const paperClassName = ["paper-surface", className].filter(Boolean).join(" ");
  const style = {
    "--paper-fold-delay": `${Math.max(0, foldDelayMs)}ms`,
    "--paper-fold-size": `${Math.max(0, foldSize)}px`,
  } as CSSProperties;
  const paperProps = {
    className: paperClassName,
    "data-paper-variant": variant,
    "data-paper-folded": folded ? "true" : "false",
    "data-paper-unfold-hover": unfoldOnHover ? "true" : "false",
    "data-paper-animate-mount": animateOnMount ? "true" : "false",
    style,
    "data-paper-unfolded": unfolded ? "true" : undefined,
    "aria-hidden": ariaHidden || undefined,
  } as const;

  if (href) {
    return (
      <Link href={href} {...paperProps}>
        {children}
      </Link>
    );
  }

  if (as === "article") {
    return <article {...paperProps}>{children}</article>;
  }

  if (as === "div") {
    return <div {...paperProps}>{children}</div>;
  }

  return <span {...paperProps}>{children}</span>;
}
