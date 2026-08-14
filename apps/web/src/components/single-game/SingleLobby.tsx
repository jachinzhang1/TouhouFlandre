import type { LucideIcon } from "lucide-react";
import { Settings, Users } from "lucide-react";
import { modeConfig, SINGLE_PLAYER_MODE_IDS } from "../../gameModes";
import { Paper } from "../Paper";
import { PageHeader } from "../layout/PageHeader";

export function SingleLobby() {
  return (
    <section className="pt-10 pb-8 max-[680px]:px-[18px] max-[680px]:pt-[28px] max-[680px]:pb-[18px]">
      <PageHeader description="沿着角色留下的线索抵达答案。" title="游戏模式" />

      <div className="game-mode-grid">
        {SINGLE_PLAYER_MODE_IDS.map((modeId, index) => {
          const config = modeConfig[modeId];
          return (
            <GameModeEntry
              href={`/single/${modeId}`}
              icon={config.icon}
              key={modeId}
              stackOrder={SINGLE_PLAYER_MODE_IDS.length + 2 - index}
              subtitle={config.description}
              title={config.label}
            />
          );
        })}
        <GameModeEntry
          href="/multi"
          icon={Users}
          subtitle="与好友在同一个房间中共同推理。"
          stackOrder={2}
          title="多人大厅"
        />
        <GameModeEntry
          href="/settings?source=single"
          icon={Settings}
          stackOrder={1}
          subtitle="自定义出题范围。"
          title="题库设置"
        />
      </div>
    </section>
  );
}

function GameModeEntry({
  href,
  icon: Icon,
  stackOrder,
  subtitle,
  title,
}: {
  href: string;
  icon: LucideIcon;
  stackOrder: number;
  subtitle: string;
  title: string;
}) {
  return (
    <Paper
      animateOnMount={false}
      as="span"
      className="game-mode-entry"
      foldSize={20}
      href={href}
      stackOrder={stackOrder}
      variant="plain"
    >
      <span className="game-mode-entry-wash" aria-hidden="true" />
      <span className="game-mode-entry-icon" aria-hidden="true">
        <Icon size={88} strokeWidth={1.2} />
      </span>
      <span className="game-mode-entry-copy">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </span>
    </Paper>
  );
}
