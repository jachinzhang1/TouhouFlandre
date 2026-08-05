"use client";

import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  Search,
  Shuffle,
} from "lucide-react";
import { GAME_CONTENT_DEFINITIONS } from "@touhoufriberg/shared";
import { useCatalogSummary } from "../hooks/useCatalogSummary";

const CHARACTER_GAME = GAME_CONTENT_DEFINITIONS.character;

export function HomePage() {
  const catalog = useCatalogSummary();
  const characterSummary = catalog?.contents.find(
    (entry) => entry.contentType === "character",
  );

  return (
    <>
      <section className="relative isolate flex min-h-[550px] items-center overflow-hidden bg-[#e8eeeb] bg-[url('/hero-touhou-collage.jpg')] bg-cover bg-[position:48%_top] before:absolute before:inset-0 before:z-[-1] before:bg-[linear-gradient(90deg,rgba(244,247,245,0.96)_0%,rgba(244,247,245,0.82)_36%,rgba(244,247,245,0.32)_58%,rgba(244,247,245,0)_78%)] max-[900px]:min-h-[510px] max-[900px]:bg-[position:47%_top] max-[900px]:before:bg-[linear-gradient(90deg,rgba(244,247,245,0.96)_0%,rgba(244,247,245,0.86)_55%,rgba(244,247,245,0.08)_100%)] max-[680px]:min-h-[420px] max-[680px]:bg-[position:46%_top] max-[680px]:before:bg-[linear-gradient(90deg,rgba(244,247,245,0.96)_0%,rgba(244,247,245,0.84)_76%,rgba(244,247,245,0.16)_100%)]">
        <div className="w-[min(610px,58%)] py-[58px] pl-[56px] animate-[hero-enter_650ms_cubic-bezier(0.2,0.75,0.25,1)_both] max-[900px]:w-[68%] max-[900px]:pl-[34px] max-[680px]:w-full max-[680px]:px-[22px] max-[680px]:py-[38px]">
          <p className="mt-0 mb-[18px] inline-flex items-center gap-2 text-[0.78rem] font-extrabold text-jade">
            <span
              className="size-[7px] rounded-full bg-jade shadow-[0_0_0_5px_rgba(36,117,104,0.12)] animate-[status-pulse_2.6s_ease-in-out_infinite]"
              aria-hidden="true"
            />
            今日题已开放
          </p>
          <h1 className="m-0 font-brand text-[4.5rem] leading-none text-[#172b26] max-[900px]:text-[3.5rem] max-[680px]:text-[2.65rem] max-[680px]:overflow-wrap-anywhere max-[420px]:text-[2.35rem]">
            东方芙一把
          </h1>
          <p className="mt-[22px] mb-0 max-w-[540px] text-[1.04rem] leading-[1.85] text-[#354b44] max-[680px]:max-w-[420px] max-[680px]:text-[0.94rem] max-[680px]:leading-[1.7]">
            从初登场作品、年份、种族、阵营、地点和头发颜色里一点点缩小范围，猜出今天的东方角色。
          </p>
          <div className="mt-7 flex flex-wrap gap-[9px] max-[420px]:grid">
            <Link className="primary-button max-[420px]:w-full" href="/single/daily">
              <CalendarDays size={18} aria-hidden="true" />
              <span>开始每日题</span>
            </Link>
            <Link className="secondary-button max-[420px]:w-full" href="/single">
              <Shuffle size={18} aria-hidden="true" />
              <span>其他模式</span>
            </Link>
          </div>
          <div
            className="mt-7 flex gap-[22px] text-[0.78rem] text-[#52635d] max-[680px]:gap-[14px] max-[420px]:justify-between max-[420px]:gap-[6px]"
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
      </section>
      <section
        className="grid grid-cols-3 border-b border-line bg-paper max-[900px]:grid-cols-1"
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

function Feature({
  icon: Icon,
  eyebrow,
  title,
  text,
  href,
}: {
  icon: typeof Search;
  eyebrow: string;
  title: string;
  text: string;
  href: string;
}) {
  return (
    <Link
      className="quick-link max-[900px]:min-h-[86px] max-[900px]:border-b max-[900px]:border-r-0 max-[900px]:last:border-b-0"
      href={href}
    >
      <span className="inline-flex size-[42px] shrink-0 items-center justify-center rounded-[4px] bg-vermilion-soft text-vermilion">
        <Icon size={20} aria-hidden="true" />
      </span>
      <span className="quick-copy">
        <small>{eyebrow}</small>
        <strong>{title}</strong>
        <span className="max-[420px]:whitespace-normal">{text}</span>
      </span>
      <ArrowRight size={18} aria-hidden="true" />
    </Link>
  );
}
