"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CalendarDays, Home, Megaphone, Search } from "lucide-react";
import { useAnnouncementUnreadCount } from "../hooks/useAnnouncementUnreadCount";
import { YinYangMark } from "./YinYangMark";
import { Paper } from "./Paper";

const NAV_ITEMS: {
  label: string;
  href: string;
  icon: typeof Home;
  isActive: (pathname: string) => boolean;
}[] = [
  { label: "首页", href: "/", icon: Home, isActive: (p) => p === "/" },
  {
    label: "游戏",
    href: "/single",
    icon: CalendarDays,
    isActive: (p) =>
      p === "/single" || p.startsWith("/single/") || p.startsWith("/multi"),
  },
  {
    label: "搜索",
    href: "/search",
    icon: Search,
    isActive: (p) => p === "/search",
  },
  {
    label: "统计",
    href: "/stats",
    icon: BarChart3,
    isActive: (p) => p === "/stats",
  },
  {
    label: "公告",
    href: "/announcement",
    icon: Megaphone,
    isActive: (p) => p === "/announcement",
  },
];

export function SiteNav() {
  const pathname = usePathname();
  const unreadAnnouncements = useAnnouncementUnreadCount();
  const activeIndex = NAV_ITEMS.findIndex((item) => item.isActive(pathname));

  return (
    <nav
      className="site-nav relative flex h-[76px] items-center justify-between gap-7 border-b border-line max-[680px]:mx-[14px] max-[680px]:h-[62px]"
      aria-label="站点导航"
    >
      <Link
        className="inline-flex items-center gap-[11px] whitespace-nowrap text-left no-underline text-ink"
        href="/"
        aria-label="返回首页"
      >
        <Paper
          ariaHidden
          as="span"
          className="brand-paper-mark inline-flex size-[38px] items-center justify-center max-[680px]:size-[34px]"
          elevation="accent"
          foldSize={8}
          sticker={false}
          tone="contrast"
          unfoldOnHover={false}
        >
          <YinYangMark className="size-[23px]" />
        </Paper>
        <span className="grid gap-px">
          <strong className="font-brand text-[1.05rem]">TouhouFlandre</strong>
          <small className="text-[0.68rem] text-ink-soft">东方芙一把</small>
        </span>
      </Link>
      <div
        data-site-nav-links
        className="site-nav-links flex items-center gap-[3px] max-[680px]:fixed max-[680px]:inset-x-0 max-[680px]:bottom-0 max-[680px]:z-40 max-[680px]:grid max-[680px]:h-[68px] max-[680px]:grid-cols-5 max-[680px]:border-t max-[680px]:border-line max-[680px]:bg-[var(--mobile-nav-bg)] max-[680px]:px-[max(5px,env(safe-area-inset-right))] max-[680px]:py-[5px] max-[680px]:pb-[max(5px,env(safe-area-inset-bottom))] max-[680px]:shadow-[var(--mobile-nav-shadow)] max-[680px]:backdrop-blur-[14px]"
        style={
          { "--nav-active-index": Math.max(0, activeIndex) } as CSSProperties
        }
      >
        {activeIndex >= 0 ? (
          <Paper
            animateOnMount={false}
            ariaHidden
            as="span"
            className="nav-active-slider"
            elevation="accent"
            foldSize={8}
            sticker={false}
            tone="contrast"
            unfoldOnHover={false}
          />
        ) : null}
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = item.isActive(pathname);
          const hasUnread =
            item.href === "/announcement" && unreadAnnouncements > 0;
          const content = (
            <>
              <Icon size={16} aria-hidden="true" />
              <span>{item.label}</span>
              {hasUnread ? (
                <span
                  className="nav-unread-dot"
                  aria-hidden="true"
                  title="有未读公告"
                />
              ) : null}
            </>
          );
          return (
            <Link
              aria-current={active ? "page" : undefined}
              aria-label={hasUnread ? `${item.label}，有未读公告` : item.label}
              className={`nav-link${active ? " active" : ""}`}
              href={item.href}
              key={item.label}
            >
              {content}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
