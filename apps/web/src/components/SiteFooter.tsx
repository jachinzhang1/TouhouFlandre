"use client";

import { Github } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

let siteVisitPromise: Promise<number | null> | null = null;

export function resetSiteVisitForTest() {
  if (process.env.NODE_ENV === "test") {
    siteVisitPromise = null;
  }
}

function recordSiteVisitOnce() {
  siteVisitPromise ??= api
    .recordSiteVisit()
    .then(({ count }) => count)
    .catch(() => null);
  return siteVisitPromise;
}

export function SiteFooter() {
  const [visitCount, setVisitCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void recordSiteVisitOnce().then((count) => {
      if (!cancelled && count !== null) {
        setVisitCount(count);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <footer className="site-footer flex min-h-[66px] items-center justify-between gap-4 border-t border-line text-[0.72rem] text-[var(--subtle-text)]">
      <span data-site-visit-count>
        TouhouFlandre · 非官方东方 Project 同人项目 · 访问数{" "}
        {visitCount === null ? "--" : visitCount.toLocaleString("zh-CN")}
      </span>
      <div className="flex items-center gap-2">
        <Link
          className="inline-flex size-5 items-center justify-center text-[var(--neutral-text)] no-underline transition-colors hover:text-vermilion"
          href="https://github.com/jachinzhang1/TouhouFlandre"
          aria-label="GitHub 仓库"
          title="GitHub 仓库"
          target="_blank"
          rel="noreferrer"
        >
          <Github size={18} aria-hidden="true" />
        </Link>
        <Link
          className="py-[5px] text-[var(--neutral-text)] no-underline hover:text-vermilion"
          href="/about"
        >
          关于
        </Link>
        <Link
          className="py-[5px] text-[var(--neutral-text)] no-underline hover:text-vermilion"
          href="/rules"
        >
          规则
        </Link>
        <Link
          className="py-[5px] text-[var(--neutral-text)] no-underline hover:text-vermilion"
          href="/settings"
        >
          设置
        </Link>
        <Link
          className="py-[5px] text-[var(--neutral-text)] no-underline hover:text-vermilion"
          href="/links"
        >
          友链与鸣谢
        </Link>
      </div>
    </footer>
  );
}
