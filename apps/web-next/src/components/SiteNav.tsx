"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  Flower2,
  Home,
  Megaphone,
  Search,
  Trophy,
} from "lucide-react";

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
      p === "/single" ||
      p.startsWith("/single/") ||
      p.startsWith("/multi"),
  },
  { label: "搜索", href: "/search", icon: Search, isActive: (p) => p === "/search" },
  { label: "统计", href: "/stats", icon: BarChart3, isActive: (p) => p === "/stats" },
  {
    label: "排行",
    href: "/leaderboard",
    icon: Trophy,
    isActive: (p) => p === "/leaderboard",
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
    <nav className="site-nav" aria-label="站点导航">
      <Link className="brand-button" href="/" aria-label="返回首页">
        <span className="brand-mark" aria-hidden="true">
          <Flower2 size={18} />
        </span>
        <span className="brand-copy">
          <strong>TouhouFlandre</strong>
          <small>东方芙一把</small>
        </span>
      </Link>
      <div className="nav-links">
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
