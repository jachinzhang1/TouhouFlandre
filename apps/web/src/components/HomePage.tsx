"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays, Search, Shuffle } from "lucide-react";
import { useCatalogSummary } from "../hooks/useCatalogSummary";

export function HomePage() {
  const catalog = useCatalogSummary();
  const characterSummary = catalog?.contents.find(
    (entry) => entry.contentType === "character",
  );

  return (
    <>
      <section className="home-hero relative isolate flex min-h-[550px] items-center overflow-hidden max-[900px]:min-h-[510px] max-[680px]:min-h-[420px]">
        <div className="w-[min(610px,58%)] py-[58px] pl-[56px] animate-[hero-enter_650ms_cubic-bezier(0.2,0.75,0.25,1)_both] max-[900px]:w-[68%] max-[900px]:pl-[34px] max-[680px]:w-full max-[680px]:px-[22px] max-[680px]:py-[38px]">
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
            根据公开词条的反馈一点点缩小范围，猜出今天的东方角色。
          </p>
          <div className="mt-7 flex flex-wrap gap-[9px] max-[420px]:grid">
            <Link
              className="primary-button max-[420px]:w-full"
              href="/single/daily"
            >
              <CalendarDays size={18} aria-hidden="true" />
              <span>开始每日题</span>
            </Link>
            <Link
              className="secondary-button max-[420px]:w-full"
              href="/single"
            >
              <Shuffle size={18} aria-hidden="true" />
              <span>其他模式</span>
            </Link>
          </div>
          <div
            className="mt-7 flex gap-[22px] text-[0.78rem] text-[var(--hero-meta)] max-[680px]:gap-[14px] max-[420px]:justify-between max-[420px]:gap-[6px]"
            aria-label="今日题信息"
          >
            <span className="flex items-baseline gap-[5px] max-[420px]:grid max-[420px]:gap-0">
              <strong className="font-brand text-[1.08rem] text-ink">
                {characterSummary?.maxGuesses ?? "-"}
              </strong>{" "}
              次机会
            </span>
            <span className="flex items-baseline gap-[5px] max-[420px]:grid max-[420px]:gap-0">
              <strong className="font-brand text-[1.08rem] text-ink">
                {characterSummary?.visibleFieldCount ?? "-"}
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
