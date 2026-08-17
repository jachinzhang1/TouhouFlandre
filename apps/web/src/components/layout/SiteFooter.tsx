"use client";

import { SiGithub } from "@icons-pack/react-simple-icons";
import { Link as LinkIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { YinYangMark } from "./YinYangMark";
import { api } from "../../lib/api";
import { VisualAlign } from "./VisualAlign";

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
  const footerMetaViewportRef = useRef<HTMLSpanElement>(null);
  const footerMetaContentRef = useRef<HTMLSpanElement>(null);

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

  useEffect(() => {
    const viewport = footerMetaViewportRef.current;
    const content = footerMetaContentRef.current;
    if (!viewport || !content) return;

    const mobileQuery = window.matchMedia?.("(max-width: 680px)");
    const fitMetadata = () => {
      const availableWidth = viewport.clientWidth;
      const contentWidth = content.scrollWidth;
      const scale =
        mobileQuery?.matches && availableWidth > 0 && contentWidth > 0
          ? Math.min(1, availableWidth / contentWidth)
          : 1;
      viewport.style.setProperty("--site-footer-meta-scale", `${scale}`);
    };

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(fitMetadata);
    resizeObserver?.observe(viewport);
    resizeObserver?.observe(content);
    mobileQuery?.addEventListener("change", fitMetadata);
    window.addEventListener("resize", fitMetadata);
    fitMetadata();

    return () => {
      resizeObserver?.disconnect();
      mobileQuery?.removeEventListener("change", fitMetadata);
      window.removeEventListener("resize", fitMetadata);
    };
  }, [visitCount]);

  return (
    <footer className="site-footer flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 text-[0.72rem]">
      <span
        className="site-footer-meta-viewport min-w-0 basis-96 grow"
        ref={footerMetaViewportRef}
      >
        <span
          className="site-footer-meta flex flex-wrap items-center gap-x-2 gap-y-1 break-words"
          data-site-visit-count
          ref={footerMetaContentRef}
        >
          <span>TouhouFlandre</span>
          <FooterSeparator />
          <span>非官方东方 Project 同人项目</span>
          <FooterSeparator />
          <span>
            访问数{" "}
            {visitCount === null ? "--" : visitCount.toLocaleString("zh-CN")}
          </span>
        </span>
      </span>
      <VisualAlign
        className="site-footer-actions flex min-w-0 flex-wrap items-center justify-end gap-2"
        edge="responsive"
        inset="inline-link"
      >
        <Link
          className="site-footer-link inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap px-2 no-underline"
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
          className="site-footer-link inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap px-2 no-underline"
          href="/links"
        >
          <LinkIcon size={16} aria-hidden="true" />
          <span>友链与鸣谢</span>
        </Link>
      </VisualAlign>
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
