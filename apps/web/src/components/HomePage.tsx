"use client";

import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  LayoutGrid,
  Search,
  Shuffle,
  type LucideIcon,
} from "lucide-react";
import { GAME_CONTENT_DEFINITIONS } from "@touhouflandre/shared";
import { useCatalogSummary } from "../hooks/useCatalogSummary";

const CHARACTER_GAME = GAME_CONTENT_DEFINITIONS.character;

export function HomePage() {
  const catalog = useCatalogSummary();
  const characterSummary = catalog?.contents.find(
    (entry) => entry.contentType === "character",
  );

  return (
    <>
      <section className="home-hero relative isolate flex min-h-[550px] items-center overflow-hidden min-[901px]:left-1/2 min-[901px]:-mt-[98px] min-[901px]:min-h-[calc(100svh-66px)] min-[901px]:w-[100dvw] min-[901px]:-translate-x-1/2 max-[900px]:min-h-[510px] max-[680px]:min-h-[420px]">
        <div className="mx-auto flex min-h-[inherit] w-full items-center min-[901px]:min-h-[calc(100svh-66px)] min-[901px]:w-[min(1240px,calc(100%-40px))] min-[901px]:flex-col min-[901px]:items-stretch min-[901px]:justify-center min-[901px]:gap-[clamp(28px,4vh,48px)] min-[901px]:pt-[80px] min-[901px]:pb-[36px]">
          <div className="w-[min(610px,58%)] py-[58px] pl-[56px] animate-[hero-enter_650ms_cubic-bezier(0.2,0.75,0.25,1)_both] min-[901px]:w-[min(680px,62%)] min-[901px]:py-0 min-[901px]:pl-0 max-[900px]:w-[68%] max-[900px]:pl-[34px] max-[680px]:w-full max-[680px]:px-[22px] max-[680px]:py-[38px]">
            <p className="mt-0 mb-[18px] inline-flex items-center gap-2 text-[0.78rem] font-extrabold text-jade">
              <span
                className="size-[7px] rounded-full bg-jade shadow-[0_0_0_5px_var(--jade-focus-soft)] animate-[status-pulse_2.6s_ease-in-out_infinite]"
                aria-hidden="true"
              />
              今日题已开放
            </p>
            <h1 className="m-0 font-brand text-[4.5rem] font-bold leading-none text-[var(--hero-title)] max-[900px]:text-[3.5rem] max-[680px]:text-[2.65rem] max-[680px]:overflow-wrap-anywhere max-[420px]:text-[2.35rem]">
              东方芙一把
            </h1>
            <p className="mt-[22px] mb-0 max-w-[540px] text-[1.04rem] leading-[1.85] text-[var(--hero-copy)] max-[680px]:max-w-[420px] max-[680px]:text-[0.94rem] max-[680px]:leading-[1.7]">
              根据初登场作品、年份、种族、阵营、地点和发色等属性一点点缩小范围，猜出今天的东方角色吧！
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
                  {
                    CHARACTER_GAME.fields.filter((field) => field.visible)
                      .length
                  }
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
      <section
        className="grid grid-cols-3 border-b border-line bg-paper min-[901px]:hidden max-[900px]:grid-cols-1"
        aria-label="快捷入口"
      >
        <Feature
          icon={CalendarDays}
          eyebrow="今日挑战"
          title="每日题"
          text="与所有玩家面对同一名角色"
          href="/single/daily"
        />
        <Feature
          icon={Shuffle}
          eyebrow="自由练习"
          title="随机题"
          text="随时开始一局新的推理"
          href="/single/random"
        />
        <Feature
          icon={LayoutGrid}
          eyebrow="玩法入口"
          title="其他模式"
          text="浏览单人和多人游戏入口"
          href="/single"
        />
        <Feature
          icon={Search}
          eyebrow="角色资料"
          title="题库索引"
          text="按名称、别名或作品检索"
          href="/search"
        />
      </section>
    </>
  );
}

function HeroShortcutMosaic() {
  return (
    <section
      className="hidden h-[210px] grid-cols-[minmax(320px,2fr)_repeat(3,minmax(0,1fr))] grid-rows-1 gap-3 min-[901px]:grid"
      aria-label="快捷入口"
    >
      <PaperShortcut
        icon={CalendarDays}
        title="每日题"
        text="与所有玩家面对同一名角色，沿着六项属性逐步缩小答案。"
        href="/single/daily"
        featured
      />
      <PaperShortcut
        icon={Shuffle}
        title="随机题"
        text="随时开始一局新的推理"
        href="/single/random"
      />
      <PaperShortcut
        icon={LayoutGrid}
        title="其他模式"
        text="单人与多人模式一览"
        href="/single"
      />
      <PaperShortcut
        icon={Search}
        title="题库索引"
        text="按名称、别名或作品检索"
        href="/search"
      />
    </section>
  );
}

function PaperShortcut({
  icon: Icon,
  title,
  text,
  href,
  featured = false,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  href: string;
  featured?: boolean;
}) {
  return (
    <Link
      className={`paper-shortcut folded-paper group ${
        featured ? "paper-shortcut-featured" : ""
      }`}
      href={href}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span
          className={`inline-flex shrink-0 items-center justify-center ${
            featured
              ? "size-14 bg-white/15 text-white"
              : "size-10 border border-[var(--accent-hover-border)] bg-vermilion-soft text-vermilion"
          }`}
        >
          <Icon size={featured ? 25 : 19} aria-hidden="true" />
        </span>
        <strong
          className={`font-brand leading-tight ${
            featured ? "text-[2rem] text-white" : "text-[1.12rem] text-ink"
          }`}
        >
          {title}
        </strong>
      </span>
      <span
        className={
          featured
            ? "max-w-[24ch] text-sm leading-7 text-white/85"
            : "text-xs leading-5 text-ink-soft"
        }
      >
        {text}
      </span>
      <ArrowRight
        className={`absolute right-6 bottom-6 transition-transform duration-180 group-hover:translate-x-1 ${
          featured ? "text-white" : "text-vermilion"
        }`}
        size={featured ? 21 : 18}
        aria-hidden="true"
      />
    </Link>
  );
}

function Feature({
  icon: Icon,
  eyebrow,
  title,
  text,
  href,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  text: string;
  href: string;
}) {
  return (
    <Link
      className="group grid min-h-[112px] min-w-0 grid-cols-[42px_1fr_auto] items-center gap-[13px] border-r border-line px-6 py-5 text-left text-ink no-underline transition-[color,background-color] duration-160 last:border-r-0 hover:bg-[var(--surface-hover)] hover:text-vermilion-dark max-[900px]:min-h-[86px] max-[900px]:border-r-0 max-[900px]:border-b max-[900px]:last:border-b-0 max-[680px]:px-[18px] max-[680px]:py-4"
      href={href}
    >
      <span className="inline-flex size-[42px] shrink-0 items-center justify-center rounded-[4px] bg-vermilion-soft text-vermilion">
        <Icon size={20} aria-hidden="true" />
      </span>
      <span className="grid min-w-0">
        <small className="text-[0.7rem] text-ink-soft">{eyebrow}</small>
        <strong className="mt-0.5 text-base">{title}</strong>
        <span className="mt-[3px] overflow-hidden text-ellipsis whitespace-nowrap text-[0.76rem] text-ink-soft max-[420px]:whitespace-normal">
          {text}
        </span>
      </span>
      <ArrowRight
        className="transition-transform duration-160 group-hover:translate-x-[3px]"
        size={18}
        aria-hidden="true"
      />
    </Link>
  );
}
