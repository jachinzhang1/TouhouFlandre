"use client";

import { SiGithub } from "@icons-pack/react-simple-icons";
import { Link as LinkIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { YinYangMark } from "./YinYangMark";
import { api } from "../../lib/api";

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
    <footer className="site-footer flex min-h-[66px] flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 text-[0.72rem]">
      <span className="flex min-w-0 basis-96 grow flex-wrap items-center gap-x-2 gap-y-1 break-words">
        <span>TouhouFlandre</span>
        <FooterSeparator />
        <span>非官方东方 Project 同人项目</span>
        <FooterSeparator />
        <span>
          访问数{" "}
          {visitCount === null ? "--" : visitCount.toLocaleString("zh-CN")}
        </span>
      </span>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        <Link
          className="inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-[4px] px-2 text-[var(--neutral-text)] no-underline transition-[color,background-color] duration-150 hover:bg-vermilion-soft hover:text-vermilion focus-visible:outline-[3px_solid_var(--focus-ring)] focus-visible:outline-offset-2"
          href="https://github.com/jachinzhang1/TouhouFlandre"
          aria-label="GitHub 仓库"
          title="GitHub 仓库"
          target="_blank"
          rel="noreferrer"
        >
          <SiGithub size={16} aria-hidden="true" />
          <span>开源托管于GitHub</span>
        </Link>
        <Link
          className="inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-[4px] px-2 text-[var(--neutral-text)] no-underline transition-[color,background-color] duration-150 hover:bg-vermilion-soft hover:text-vermilion focus-visible:outline-[3px_solid_var(--focus-ring)] focus-visible:outline-offset-2"
          href="/links"
        >
          <LinkIcon size={16} aria-hidden="true" />
          <span>友链与鸣谢</span>
        </Link>
      </div>
    </footer>
  );
}

function FooterSeparator() {
  return (
    <YinYangMark
      className="footer-yin-yang size-3 shrink-0"
      variant="separator"
    />
  );
}
