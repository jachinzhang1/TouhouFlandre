"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  Home,
  Menu,
  Megaphone,
  Search,
  X,
} from "lucide-react";
import { installAnnouncementDevelopmentTools } from "../../announcements/readState";
import { useAnnouncementUnreadCount } from "../../hooks/useAnnouncementUnreadCount";
import { installStatisticsDevelopmentTools } from "../../stats/devSeed";
import { Paper } from "@/components/paper";
import { YinYangMark } from "./YinYangMark";
import { AppearanceSwitcher } from "./AppearanceSwitcher";

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
      p.startsWith("/multi") ||
      p === "/settings",
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

type MobilePresentation = "navigation" | "palette" | null;

export function SiteNav() {
  const pathname = usePathname();
  const unreadAnnouncements = useAnnouncementUnreadCount();
  const navLinksRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [mobilePresentation, setMobilePresentation] =
    useState<MobilePresentation>(null);
  const mobileMenuOpen = mobilePresentation === "navigation";
  const mobilePaletteOpen = mobilePresentation === "palette";
  const mobilePresentationOpen = mobilePresentation !== null;
  const [activeIndicatorHovered, setActiveIndicatorHovered] = useState(false);
  const [indicatorMoving, setIndicatorMoving] = useState(false);
  const hasActiveNavItem = NAV_ITEMS.some((item) => item.isActive(pathname));

  useEffect(() => {
    const uninstallAnnouncements = installAnnouncementDevelopmentTools();
    const uninstallStatistics = installStatisticsDevelopmentTools();
    return () => {
      uninstallAnnouncements();
      uninstallStatistics();
    };
  }, []);

  useEffect(() => {
    setActiveIndicatorHovered(false);
    setMobilePresentation(null);
  }, [pathname]);

  useEffect(() => {
    if (!mobilePresentationOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMobilePresentation(null);
      toggleRef.current?.focus();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [mobilePresentationOpen]);

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
    if (
      navLinks.dataset.indicatorAnimated === "true" &&
      navLinks.dataset.indicatorReady === "true"
    ) {
      setIndicatorMoving(true);
      unfoldTimer = window.setTimeout(() => setIndicatorMoving(false), 280);
    } else {
      setIndicatorMoving(false);
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
  }, [mobileMenuOpen, pathname]);

  return (
    <nav
      aria-label="站点导航"
      className="site-nav"
      data-mobile-menu-open={mobileMenuOpen ? "true" : "false"}
      data-mobile-presentation={mobilePresentation ?? "none"}
    >
      <span className="site-nav-paper-layer" aria-hidden="true" />
      <Link
        aria-label="返回首页"
        className="site-brand"
        href="/"
        onClick={() => setMobilePresentation(null)}
      >
        <Paper
          className="brand-paper-mark"
          elevation="accent"
          foldSize={8}
          sticker={false}
          tone="contrast"
          unfoldOnHover={false}
        >
          <YinYangMark className="size-[23px]" />
        </Paper>
        <span className="site-brand-copy">
          <strong className="site-brand-title">东方芙一把</strong>
          <small className="site-brand-subtitle">TouhouFlandre</small>
        </span>
      </Link>
      <div className="site-nav-actions">
        <AppearanceSwitcher
          mobilePaletteOpen={mobilePaletteOpen}
          onMobilePaletteOpenChange={(open) =>
            setMobilePresentation(open ? "palette" : null)
          }
        />
        <button
          aria-controls="site-navigation-links appearance-palette"
          aria-expanded={mobilePresentationOpen}
          aria-label={
            mobilePresentation === "palette"
              ? "关闭主题颜色"
              : mobileMenuOpen
                ? "关闭站点导航"
                : "展开站点导航"
          }
          className="site-nav-toggle"
          onClick={() =>
            setMobilePresentation((current) =>
              current === null ? "navigation" : null,
            )
          }
          ref={toggleRef}
          type="button"
        >
          <Menu
            className="site-nav-toggle-icon site-nav-menu-icon"
            aria-hidden="true"
          />
          <X
            className="site-nav-toggle-icon site-nav-close-icon"
            aria-hidden="true"
          />
        </button>
      </div>
      <div
        className="nav-links"
        data-site-nav-links
        id="site-navigation-links"
        ref={navLinksRef}
      >
        <span className="nav-active-indicator" aria-hidden="true">
          <Paper
            animateOnMount={false}
            className="nav-active-paper"
            elevation="accent"
            foldSize={10}
            sticker={false}
            tone="contrast"
            unfoldOnHover={false}
            unfolded={indicatorMoving || activeIndicatorHovered}
          />
        </span>
        {hasActiveNavItem ? (
          <div className="nav-active-copy" aria-hidden="true">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const hasUnread =
                item.href === "/announcement" && unreadAnnouncements > 0;
              return (
                <span className="nav-link nav-link-copy" key={item.label}>
                  <Icon size={16} aria-hidden="true" />
                  <span className="nav-link-label">{item.label}</span>
                  {hasUnread ? (
                    <span className="nav-unread-dot" aria-hidden="true" />
                  ) : null}
                </span>
              );
            })}
          </div>
        ) : null}
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = item.isActive(pathname);
          const hasUnread =
            item.href === "/announcement" && unreadAnnouncements > 0;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              aria-label={hasUnread ? `${item.label}，有未读公告` : item.label}
              className={active ? "nav-link active" : "nav-link"}
              href={item.href}
              key={item.label}
              onClick={() => {
                setMobilePresentation(null);
                if (mobileMenuOpen) {
                  document
                    .querySelector<HTMLElement>(".site-main")
                    ?.focus({ preventScroll: true });
                }
              }}
              onPointerEnter={() => {
                if (active) setActiveIndicatorHovered(true);
              }}
              onPointerLeave={() => {
                if (active) setActiveIndicatorHovered(false);
              }}
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
