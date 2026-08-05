import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="flex min-h-[66px] items-center justify-between gap-4 border-t border-line text-[0.72rem] text-[#73817c]">
      <span>TouhouFlandre · 非官方东方 Project 同人项目</span>
      <Link
        className="py-[5px] text-[#5b6b65] no-underline hover:text-vermilion"
        href="/links"
      >
        友链与鸣谢
      </Link>
    </footer>
  );
}
