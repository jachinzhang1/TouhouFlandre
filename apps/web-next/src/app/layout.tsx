import type { Metadata, Viewport } from "next";
import { SiteFooter } from "../components/SiteFooter";
import { SiteNav } from "../components/SiteNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "东方角色芙一把 · TouhouFlandre",
  description: "东方角色芙一把（TouhouFlandre）- 东方 Project 角色推理游戏",
  icons: { icon: "/favicon.png" },
};

export const viewport: Viewport = {
  themeColor: "#f2f5f3",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hans">
      <body>
        <div className="app-shell">
          <SiteNav />
          <main className="page-content">{children}</main>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
