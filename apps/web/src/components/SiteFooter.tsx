import { Github } from "lucide-react";
import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="flex min-h-[66px] items-center justify-between gap-4 border-t border-line text-[0.72rem] text-[var(--subtle-text)]">
      <span>TouhouFlandre · 非官方东方 Project 同人项目</span>
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
          href="/links"
        >
          友链与鸣谢
        </Link>
      </div>
    </footer>
  );
}
