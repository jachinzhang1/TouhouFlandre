"use client";

import type { LucideIcon } from "lucide-react";
import { Settings, Users } from "lucide-react";
import { useState } from "react";
import { modeConfig, SINGLE_PLAYER_MODE_IDS } from "../../gameModes";
import { Paper } from "../Paper";
import { QuestionScopeDialog } from "../question-scope/QuestionScopeDialog";

export function SingleLobby() {
  const [scopeOpen, setScopeOpen] = useState(false);

  return (
    <>
      <section className="pt-10 pb-8 max-[680px]:px-[18px] max-[680px]:pt-[28px] max-[680px]:pb-[18px]">
        <header className="text-center">
          <h1 className="mt-0 mb-0 font-brand text-[2.6rem] font-black leading-[1.15] max-[680px]:text-[2.05rem]">
            游戏模式
          </h1>
          <p className="mx-auto mt-3 mb-0 flex min-h-7 max-w-[720px] items-center justify-center text-center font-brand leading-[1.75] text-ink-soft">
            沿着角色留下的线索抵达答案。
          </p>
        </header>

        <div className="game-mode-grid">
          {SINGLE_PLAYER_MODE_IDS.map((modeId) => {
            const config = modeConfig[modeId];
            return (
              <GameModeEntry
                href={`/single/${modeId}`}
                icon={config.icon}
                key={modeId}
                subtitle={config.description}
                title={config.label}
              />
            );
          })}
          <GameModeEntry
            href="/multi"
            icon={Users}
            subtitle="与好友在同一个房间中共同推理。"
            title="多人大厅"
          />
          <GameModeEntry
            icon={Settings}
            onClick={() => setScopeOpen(true)}
            subtitle="自定义出题范围。"
            title="题库设置"
          />
        </div>
      </section>
      <QuestionScopeDialog
        open={scopeOpen}
        onClose={() => setScopeOpen(false)}
      />
    </>
  );
}

function GameModeEntry({
  href,
  icon: Icon,
  onClick,
  subtitle,
  title,
}: {
  href?: string;
  icon: LucideIcon;
  onClick?: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <Paper
      animateOnMount={false}
      as={href ? "span" : "button"}
      className="game-mode-entry paper-sticker-shadow"
      foldSize={20}
      href={href}
      onClick={onClick}
      variant="plain"
    >
      <span className="game-mode-entry-icon" aria-hidden="true">
        <Icon size={118} strokeWidth={1.05} />
      </span>
      <span className="game-mode-entry-copy">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </span>
    </Paper>
  );
}
