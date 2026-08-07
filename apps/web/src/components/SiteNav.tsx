"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  Home,
  Megaphone,
  Search,
} from "lucide-react";
import { YinYangMark } from "./YinYangMark";

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

  return (
    <nav
      className="relative z-20 flex h-[76px] items-center justify-between gap-7 border-b border-line max-[680px]:mx-[14px] max-[680px]:h-[62px]"
      aria-label="站点导航"
    >
      <Link
        className="inline-flex items-center gap-[11px] whitespace-nowrap text-left no-underline text-ink"
        href="/"
        aria-label="返回首页"
      >
        <span className="inline-flex size-[38px] items-center justify-center rounded-[4px] bg-vermilion text-[var(--accent-contrast)] shadow-[4px_4px_0_var(--brand-shadow)] max-[680px]:size-[34px]">
          <YinYangMark className="size-[23px]" />
        </span>
        <span className="grid gap-px">
          <strong className="font-brand text-[1.05rem]">TouhouFlandre</strong>
          <small className="text-[0.68rem] text-ink-soft">东方芙一把</small>
        </span>
      </Link>
      <div className="flex items-center gap-[3px] max-[680px]:fixed max-[680px]:inset-x-0 max-[680px]:bottom-0 max-[680px]:z-40 max-[680px]:grid max-[680px]:h-[68px] max-[680px]:grid-cols-5 max-[680px]:border-t max-[680px]:border-line max-[680px]:bg-[var(--mobile-nav-bg)] max-[680px]:px-[max(5px,env(safe-area-inset-right))] max-[680px]:py-[5px] max-[680px]:pb-[max(5px,env(safe-area-inset-bottom))] max-[680px]:shadow-[var(--mobile-nav-shadow)] max-[680px]:backdrop-blur-[14px]">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = item.isActive(pathname);
          return (
            <Link
              className={active ? "nav-link active" : "nav-link"}
              key={item.label}
              href={item.href}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
