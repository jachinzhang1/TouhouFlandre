import type { Metadata, Viewport } from "next";
import { SiteFooter } from "../components/SiteFooter";
import { SiteNav } from "../components/SiteNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "东方芙一把 · TouhouFlandre",
  description: "东方芙一把（TouhouFlandre）- 东方 Project 角色推理游戏",
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
      <body className="max-[680px]:pb-[68px]">
        <div className="mx-auto w-[min(1240px,calc(100%-40px))] min-h-screen max-[680px]:w-full">
          <SiteNav />
          <main className="pb-11 pt-[22px] min-h-[calc(100vh-142px)] max-[680px]:min-h-[calc(100vh-128px)] max-[680px]:pb-7 max-[680px]:pt-3">
            {children}
          </main>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
