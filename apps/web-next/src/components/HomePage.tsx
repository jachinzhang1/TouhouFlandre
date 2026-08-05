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
      <section className="hero-page">
        <div className="hero-content">
          <p className="hero-status">
            <span aria-hidden="true" /> 今日题已开放
          </p>
          <h1>东方角色芙一把</h1>
          <p className="hero-lead">
            从初登场作品、年份、种族、阵营、地点和头发颜色里一点点缩小范围，猜出今天的东方角色。
          </p>
          <div className="hero-actions">
            <Link className="primary-button" href="/single/daily">
              <CalendarDays size={18} aria-hidden="true" />
              <span>开始每日题</span>
            </Link>
            <Link className="secondary-button" href="/single">
              <Shuffle size={18} aria-hidden="true" />
              <span>其他模式</span>
            </Link>
          </div>
          <div className="hero-meta" aria-label="今日题信息">
            <span>
              <strong>{CHARACTER_GAME.maxGuesses}</strong> 次机会
            </span>
            <span>
              <strong>
                {CHARACTER_GAME.fields.filter((field) => field.visible).length}
              </strong>{" "}
              项线索
            </span>
            <span>
              <strong>{characterSummary?.guessable ?? "-"}</strong> 名角色
            </span>
          </div>
        </div>
      </section>
      <section className="home-quickbar" aria-label="快捷入口">
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
    <Link className="quick-link" href={href}>
      <span className="quick-icon">
        <Icon size={20} aria-hidden="true" />
      </span>
      <span className="quick-copy">
        <small>{eyebrow}</small>
        <strong>{title}</strong>
        <span>{text}</span>
      </span>
      <ArrowRight size={18} aria-hidden="true" />
    </Link>
  );
}
