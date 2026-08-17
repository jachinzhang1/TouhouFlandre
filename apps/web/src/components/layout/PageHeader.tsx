import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { AriaRole, ReactNode } from "react";
import { VisualAlign, type VisualAlignInset } from "./VisualAlign";

export function PageHeader({
  description,
  descriptionRole,
  leftSlot,
  rightSlot,
  rightSlotInset = "icon-button",
  title,
}: {
  description: ReactNode;
  descriptionRole?: AriaRole;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  rightSlotInset?: VisualAlignInset;
  title: ReactNode;
}) {
  return (
    <header
      className={`page-header${leftSlot ? " page-header-has-left" : ""}${rightSlot ? " page-header-has-right" : ""}`}
    >
      {leftSlot ? (
        <div className="page-header-slot page-header-slot-left">{leftSlot}</div>
      ) : null}
      <div className="page-header-copy">
        <h1 className="page-header-title">{title}</h1>
        <p className="page-header-description" role={descriptionRole}>
          {description}
        </p>
      </div>
      {rightSlot ? (
        <div className="page-header-slot page-header-slot-right">
          <VisualAlign edge="mobile-start" inset={rightSlotInset}>
            {rightSlot}
          </VisualAlign>
        </div>
      ) : null}
    </header>
  );
}

export function PageBackLink({
  children = "返回",
  href,
}: {
  children?: ReactNode;
  href: string;
}) {
  return (
    <Link className="page-header-back" href={href}>
      <ChevronLeft size={20} strokeWidth={2.2} aria-hidden="true" />
      <span>{children}</span>
    </Link>
  );
}

export function PageHeaderAction({
  ariaLabel,
  children,
  disabled = false,
  onClick,
  title,
  tone = "plain",
}: {
  ariaLabel: string;
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  tone?: "plain" | "theme" | "danger";
}) {
  return (
    <button
      aria-label={ariaLabel}
      className={`page-header-action page-header-action-${tone}`}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}
