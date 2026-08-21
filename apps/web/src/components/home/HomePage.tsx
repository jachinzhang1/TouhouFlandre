"use client";

import {
  ArrowRight,
  CalendarDays,
  LayoutGrid,
  Search,
  Shuffle,
  type LucideIcon,
} from "lucide-react";
import { GAME_CONTENT_DEFINITIONS } from "@touhouflandre/shared";
import { Paper } from "@/components/paper";
import { useCatalogSummary } from "../../hooks/useCatalogSummary";

const CHARACTER_GAME = GAME_CONTENT_DEFINITIONS.character;

export function HomePage() {
  const catalog = useCatalogSummary();
  const characterSummary = catalog?.contents.find(
    (entry) => entry.contentType === "character",
  );

  return (
    <section className="home-hero relative isolate flex min-h-[550px] items-center overflow-hidden min-[901px]:left-1/2 min-[901px]:-mt-[98px] min-[901px]:min-h-[100svh] min-[901px]:w-[100dvw] min-[901px]:-translate-x-1/2 max-[900px]:min-h-[510px] max-[680px]:min-h-[420px]">
      <span className="home-hero-blur-gentle" aria-hidden="true" />
      <span className="home-hero-blur-strong" aria-hidden="true" />
      <div className="home-hero-layout site-content-width relative z-[3] mx-auto flex min-h-[inherit] w-full items-center min-[901px]:min-h-[100svh] min-[901px]:flex-col min-[901px]:items-stretch min-[901px]:justify-center min-[901px]:gap-[clamp(28px,4vh,48px)] min-[901px]:pt-[80px] min-[901px]:pb-[36px]">
        <div className="home-hero-copy w-[min(610px,58%)] py-[58px] pl-[56px] animate-[hero-enter_650ms_cubic-bezier(0.2,0.75,0.25,1)_both] min-[901px]:w-[min(680px,62%)] min-[901px]:py-0 min-[901px]:pl-0 max-[900px]:w-[68%] max-[900px]:pl-[34px] max-[680px]:w-full max-[680px]:px-[22px] max-[680px]:py-[38px]">
          <h1 className="m-0 font-brand text-[4.5rem] font-bold leading-none text-[var(--hero-title)] max-[900px]:text-[3.5rem] max-[680px]:text-[2.65rem] max-[680px]:overflow-wrap-anywhere max-[420px]:text-[2.35rem]">
            东方芙一把
          </h1>
          <p className="mt-[22px] mb-0 max-w-[540px] font-brand text-[1.04rem] leading-[1.85] text-[var(--hero-copy)] max-[680px]:max-w-[420px] max-[680px]:text-[0.94rem] max-[680px]:leading-[1.7]">
            根据初登场作品、年份、种族、阵营、地点和发色属性一点点缩小范围，猜出今天的东方角色吧！
          </p>
          <div
            className="mt-7 flex gap-[22px] text-[0.78rem] text-[var(--hero-meta)] max-[680px]:gap-[14px] max-[420px]:justify-between max-[420px]:gap-[6px]"
            aria-label="今日题信息"
          >
            <span className="flex items-baseline gap-[5px] max-[420px]:grid max-[420px]:gap-0">
              <strong className="font-brand text-[1.08rem] text-ink">
                {CHARACTER_GAME.maxGuesses}
              </strong>{" "}
              次机会
            </span>
            <span className="flex items-baseline gap-[5px] max-[420px]:grid max-[420px]:gap-0">
              <strong className="font-brand text-[1.08rem] text-ink">
                {CHARACTER_GAME.fields.filter((field) => field.visible).length}
              </strong>{" "}
              项线索
            </span>
            <span className="flex items-baseline gap-[5px] max-[420px]:grid max-[420px]:gap-0">
              <strong className="font-brand text-[1.08rem] text-ink">
                {characterSummary?.guessable ?? "-"}
              </strong>{" "}
              名角色
            </span>
          </div>
        </div>
        <HeroShortcutMosaic />
      </div>
    </section>
  );
}

function HeroShortcutMosaic() {
  return (
    <section
      className="home-hero-shortcuts hidden h-[210px] grid-cols-[minmax(320px,2fr)_repeat(3,minmax(0,1fr))] grid-rows-1 gap-3 min-[901px]:grid"
      aria-label="快捷入口"
    >
      <PaperShortcut
        icon={CalendarDays}
        title="每日题"
        text="今天的每日角色会是谁呢……？"
        href="/single/daily"
        foldDelayMs={80}
        featured
      />
      <PaperShortcut
        icon={Shuffle}
        title="随机题"
        text="随时开始一局新的推理"
        href="/single/random"
        foldDelayMs={140}
      />
      <PaperShortcut
        icon={LayoutGrid}
        title="其他模式"
        text="单人与多人模式一览"
        href="/single"
        foldDelayMs={200}
      />
      <PaperShortcut
        icon={Search}
        title="题库索引"
        text="按名称、别名或作品检索"
        href="/search"
        foldDelayMs={260}
      />
    </section>
  );
}

function PaperShortcut({
  icon: Icon,
  title,
  text,
  href,
  foldDelayMs,
  featured = false,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  href: string;
  foldDelayMs: number;
  featured?: boolean;
}) {
  return (
    <Paper
      className={`paper-shortcut${featured ? " paper-shortcut-featured" : ""}`}
      href={href}
      variant="plain"
      foldDelayMs={foldDelayMs}
      foldSize={24}
      pattern
    >
      <strong className="paper-shortcut-title font-brand text-[1.32rem] leading-tight">
        {title}
      </strong>
      <span className="paper-shortcut-description text-sm leading-6 text-ink-soft">
        {text}
      </span>
      <span className="paper-shortcut-action" aria-hidden="true">
        <Icon className="paper-shortcut-icon" size={40} strokeWidth={1.25} />
        <ArrowRight
          className="paper-shortcut-hover-arrow"
          size={40}
          strokeWidth={1.25}
        />
      </span>
    </Paper>
  );
}
