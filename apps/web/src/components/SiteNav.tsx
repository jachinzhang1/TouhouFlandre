"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef } from "react";
import { BarChart3, CalendarDays, Home, Megaphone, Search } from "lucide-react";
import { useAnnouncementUnreadCount } from "../hooks/useAnnouncementUnreadCount";
import { Paper } from "./Paper";
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
  const unreadAnnouncements = useAnnouncementUnreadCount();
  const navLinksRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const navLinks = navLinksRef.current;
    if (!navLinks) return;
    let animationFrame = 0;
    let unfoldTimer = 0;

    const updateIndicator = () => {
      const activeLink = navLinks.querySelector<HTMLElement>(
        '.nav-link[aria-current="page"]',
      );
      if (!activeLink) {
        delete navLinks.dataset.indicatorReady;
        return;
      }

      navLinks.style.setProperty(
        "--nav-active-x",
        `${activeLink.offsetLeft}px`,
      );
      navLinks.style.setProperty("--nav-active-y", `${activeLink.offsetTop}px`);
      navLinks.style.setProperty(
        "--nav-active-width",
        `${activeLink.offsetWidth}px`,
      );
      navLinks.style.setProperty(
        "--nav-active-height",
        `${activeLink.offsetHeight}px`,
      );
      navLinks.dataset.indicatorReady = "true";
      if (navLinks.dataset.indicatorInitialized !== "true") {
        navLinks.dataset.indicatorInitialized = "true";
      }
      if (
        navLinks.dataset.indicatorAnimated !== "true" &&
        animationFrame === 0
      ) {
        animationFrame = window.requestAnimationFrame(() => {
          navLinks.dataset.indicatorAnimated = "true";
          animationFrame = 0;
        });
      }
    };

    updateIndicator();
    if (navLinks.dataset.indicatorAnimated === "true") {
      navLinks.dataset.indicatorMoving = "true";
      unfoldTimer = window.setTimeout(() => {
        delete navLinks.dataset.indicatorMoving;
      }, 280);
    }
    window.addEventListener("resize", updateIndicator);
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateIndicator);
    resizeObserver?.observe(navLinks);
    for (const link of navLinks.querySelectorAll(".nav-link")) {
      resizeObserver?.observe(link);
    }

    return () => {
      window.clearTimeout(unfoldTimer);
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", updateIndicator);
      resizeObserver?.disconnect();
    };
  }, [pathname]);

  return (
    <nav
      className="site-nav relative z-20 flex h-[76px] items-center justify-between gap-7 max-[680px]:h-[62px]"
      aria-label="站点导航"
    >
      <span className="site-nav-paper-layer" aria-hidden="true" />
      <Link
        className="inline-flex items-center gap-[11px] whitespace-nowrap text-left no-underline text-ink"
        href="/"
        aria-label="返回首页"
      >
        <Paper
          className="brand-paper-mark inline-flex size-[38px] items-center justify-center text-[var(--accent-contrast)] max-[680px]:size-[34px]"
          variant="tinted"
          foldSize={8}
          unfoldOnHover={false}
        >
          <YinYangMark className="size-[23px]" />
        </Paper>
        <span className="grid gap-0 leading-none">
          <strong className="font-brand text-[1.16rem] leading-none">
            东方芙一把
          </strong>
          <small className="font-brand text-[0.7rem] leading-none text-ink-soft">
            TouhouFlandre
          </small>
        </span>
      </Link>
      <div
        ref={navLinksRef}
        className="nav-links flex items-center gap-[3px] max-[680px]:fixed max-[680px]:inset-x-0 max-[680px]:bottom-0 max-[680px]:z-40 max-[680px]:grid max-[680px]:h-[68px] max-[680px]:grid-cols-5 max-[680px]:border-t max-[680px]:border-line max-[680px]:bg-[var(--nav-bg)] max-[680px]:px-[max(5px,env(safe-area-inset-right))] max-[680px]:py-[5px] max-[680px]:pb-[max(5px,env(safe-area-inset-bottom))] max-[680px]:shadow-[var(--mobile-nav-shadow)] max-[680px]:backdrop-blur-[24px]"
      >
        <Paper
          className="nav-active-indicator"
          animateOnMount={false}
          variant="tinted"
          unfoldOnHover={false}
          foldSize={10}
          ariaHidden
        />
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = item.isActive(pathname);
          const hasUnread =
            item.href === "/announcement" && unreadAnnouncements > 0;
          return (
            <Link
              className={active ? "nav-link active" : "nav-link"}
              key={item.label}
              href={item.href}
              aria-current={active ? "page" : undefined}
              aria-label={hasUnread ? `${item.label}，有未读公告` : item.label}
            >
              <Icon size={16} aria-hidden="true" />
              <span className="nav-link-label">{item.label}</span>
              {hasUnread ? (
                <span
                  className="nav-unread-dot"
                  aria-hidden="true"
                  title="有未读公告"
                />
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
