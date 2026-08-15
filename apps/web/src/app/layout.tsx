import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { AgentationToolbar } from "../components/dev/AgentationToolbar";
import { AppearanceSwitcher } from "../components/layout/AppearanceSwitcher";
import { SiteFooter } from "../components/layout/SiteFooter";
import { SiteNav } from "../components/layout/SiteNav";
import { createAppearanceBootstrapScript } from "../lib/appearanceBootstrap";
import "./globals.css";

export const metadata: Metadata = {
  title: "东方芙一把 · TouhouFlandre",
  description: "东方芙一把（TouhouFlandre）- 东方 Project 角色推理游戏",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.png", type: "image/png" },
    ],
  },
  other: {
    "darkreader-lock": "TouhouFlandre provides native color themes",
  },
};

export const viewport: Viewport = {
  themeColor: "#f2f5f3",
};

const appearanceBootstrapScript = createAppearanceBootstrapScript();

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hans" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body className="max-[680px]:pb-[68px]">
        <Script id="appearance-bootstrap" strategy="beforeInteractive">
          {appearanceBootstrapScript}
        </Script>
        <div className="mx-auto w-[min(1240px,calc(100%-40px))] min-h-screen max-[680px]:w-full">
          <SiteNav />
          <main className="pb-11 pt-[22px] min-h-[calc(100vh-142px)] max-[680px]:min-h-[calc(100vh-128px)] max-[680px]:pb-7 max-[680px]:pt-3">
            {children}
          </main>
          <SiteFooter />
        </div>
        <AppearanceSwitcher />
        {process.env.NODE_ENV === "development" ? <AgentationToolbar /> : null}
      </body>
    </html>
  );
}
