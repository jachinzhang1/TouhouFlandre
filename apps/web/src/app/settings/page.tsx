"use client";

import Link from "next/link";
import { useState } from "react";
import { Database, Palette, SlidersHorizontal } from "lucide-react";
import { Paper } from "../../components/Paper";
import { QuestionScopeDialog } from "../../components/QuestionScopeDialog";

export default function SettingsPage() {
  const [scopeOpen, setScopeOpen] = useState(false);

  return (
    <section className="info-page px-[18px] pt-12 pb-8 max-[680px]:pt-8">
      <header className="max-w-[720px] border-b border-line pb-5">
        <p className="mb-2 text-[0.69rem] font-black tracking-[0.12em] text-vermilion">
          SETTINGS
        </p>
        <h1 className="font-brand text-[2.6rem] font-bold leading-tight max-[680px]:text-[2.05rem]">
          设置
        </h1>
        <p className="mt-3 leading-7 text-ink-soft">
          按需展开设置项；改动只影响当前浏览器或新创建的题局。
        </p>
      </header>

      <div className="mt-5 grid max-w-[920px] gap-3">
        <SettingCard
          icon={Palette}
          title="外观主题"
          summary="明暗模式与角色主题色"
        >
          <p>
            使用页面右下角的折角按钮。展开扇形色带后选择主题色，再次点击中央按钮切换明暗模式。
          </p>
        </SettingCard>

        <SettingCard
          icon={SlidersHorizontal}
          title="出题范围"
          summary="难度、字段、作品与猜测限制"
        >
          <p>设置会应用到之后创建的单人题局和由你创建的多人房间。</p>
          <button
            type="button"
            className="mt-3 inline-flex min-h-10 items-center justify-center rounded-[5px] bg-vermilion px-4 text-sm font-bold text-[var(--accent-contrast)]"
            onClick={() => setScopeOpen(true)}
          >
            打开题库设置
          </button>
        </SettingCard>

        <SettingCard
          icon={Database}
          title="本地数据"
          summary="统计导入、导出与清除"
        >
          <p>
            游玩历史保存在 IndexedDB
            中，不会自动上传。导入、导出和清除操作集中在统计页。
          </p>
          <Link
            className="mt-3 inline-flex min-h-10 items-center justify-center rounded-[5px] border border-line-strong px-4 text-sm font-bold text-ink no-underline hover:bg-paper-muted"
            href="/stats"
          >
            前往游玩统计
          </Link>
        </SettingCard>
      </div>

      {scopeOpen ? (
        <QuestionScopeDialog open onClose={() => setScopeOpen(false)} />
      ) : null}
    </section>
  );
}

function SettingCard({
  children,
  icon: Icon,
  summary,
  title,
}: {
  children: React.ReactNode;
  icon: typeof Palette;
  summary: string;
  title: string;
}) {
  return (
    <Paper
      as="article"
      className="info-disclosure-card p-0"
      foldSize={12}
      pattern
      unfoldOnHover={false}
    >
      <details>
        <summary className="grid cursor-pointer grid-cols-[38px_minmax(0,1fr)] items-center gap-3 px-4 py-4 marker:content-none">
          <span className="inline-flex size-[38px] items-center justify-center rounded-[5px] bg-vermilion-soft text-vermilion">
            <Icon size={19} aria-hidden="true" />
          </span>
          <span className="grid gap-1">
            <strong className="text-base text-ink">{title}</strong>
            <span className="text-xs text-ink-soft">{summary}</span>
          </span>
        </summary>
        <div className="border-t border-dashed border-line px-4 py-4 text-sm leading-7 text-ink-soft">
          {children}
        </div>
      </details>
    </Paper>
  );
}
