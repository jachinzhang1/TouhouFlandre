import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <span>TouhouFlandre · 非官方东方 Project 同人项目</span>
      <Link href="/links">友链与鸣谢</Link>
    </footer>
  );
}
