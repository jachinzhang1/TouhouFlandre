import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { AppearanceSwitcher } from "../components/AppearanceSwitcher";
import { SiteFooter } from "../components/SiteFooter";
import { SiteNav } from "../components/SiteNav";
import { MusicPlayerRoot } from "../features/music-player/MusicPlayerRoot";
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
};

export const viewport: Viewport = {
  themeColor: "#f2f5f3",
};

const appearanceBootstrapScript = `
(() => {
  const storageKey = "touhoufriberg:appearance";
  const colors = new Set(["scarlet", "sakura", "iris", "jade", "amber", "azure"]);
  const systemMode = () =>
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  let stored = {};

  try {
    stored = JSON.parse(window.localStorage.getItem(storageKey) || "{}") || {};
  } catch {
    stored = {};
  }

  const mode =
    stored.mode === "light" || stored.mode === "dark"
      ? stored.mode
      : systemMode();
  const color = colors.has(stored.color) ? stored.color : "scarlet";
  const root = document.documentElement;
  root.dataset.themeMode = mode;
  root.dataset.themeColor = color;
  root.style.colorScheme = mode;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", mode === "dark" ? "#0f1413" : "#f2f5f3");
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-Hans"
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <body className="max-[680px]:pb-[68px]">
        <Script
          id="appearance-bootstrap"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: appearanceBootstrapScript }}
        />
        <div className="mx-auto w-[min(1240px,calc(100%-40px))] min-h-screen max-[680px]:w-full">
          <SiteNav />
          <main className="pb-11 pt-[22px] min-h-[calc(100vh-142px)] max-[680px]:min-h-[calc(100vh-128px)] max-[680px]:pb-7 max-[680px]:pt-3">
            {children}
          </main>
          <SiteFooter />
        </div>
        <AppearanceSwitcher />
        <MusicPlayerRoot />
      </body>
    </html>
  );
}
