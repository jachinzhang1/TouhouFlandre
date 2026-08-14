import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { AriaRole, ReactNode } from "react";

export function PageHeader({
  description,
  descriptionRole,
  leftSlot,
  rightSlot,
  title,
}: {
  description: ReactNode;
  descriptionRole?: AriaRole;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  title: ReactNode;
}) {
  return (
    <header
      className={`page-header text-center${leftSlot ? " page-header-has-left" : ""}${rightSlot ? " page-header-has-right" : ""}`}
    >
      {leftSlot ? (
        <div className="page-header-slot page-header-slot-left">{leftSlot}</div>
      ) : null}
      <div className="page-header-copy">
        <h1 className="mt-0 mb-0 font-brand text-[2.6rem] font-black leading-[1.15] max-[680px]:text-[2.05rem]">
          {title}
        </h1>
        <p
          className="mx-auto mt-3 mb-0 flex min-h-7 max-w-[720px] items-center justify-center text-center font-brand leading-[1.75] text-ink-soft"
          role={descriptionRole}
        >
          {description}
        </p>
      </div>
      {rightSlot ? (
        <div className="page-header-slot page-header-slot-right">
          {rightSlot}
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
