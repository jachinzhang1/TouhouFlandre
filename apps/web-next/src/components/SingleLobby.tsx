import Link from "next/link";
import { ArrowRight, Shield, Users } from "lucide-react";
import { modeConfig, SINGLE_PLAYER_MODE_IDS } from "../gameModes";

export function SingleLobby() {
  return (
    <section className="page-panel">
      <div className="page-heading">
        <p className="kicker">PLAY</p>
        <h1>游戏模式</h1>
        <p>选择一局，沿着角色留下的线索抵达答案。</p>
      </div>
      <div className="mode-choice-grid">
        {SINGLE_PLAYER_MODE_IDS.map((modeId) => {
          const config = modeConfig[modeId];
          const Icon = config.icon;
          return (
            <Link className="mode-choice" key={modeId} href={`/single/${modeId}`}>
              <span className="mode-choice-top">
                <span className="mode-icon">
                  <Icon size={22} aria-hidden="true" />
                </span>
                <small className={`mode-state ${config.stateClass}`.trim()}>
                  {config.stateLabel}
                </small>
              </span>
              <span className="mode-title">
                <strong>{config.label}</strong>
                <ArrowRight size={20} aria-hidden="true" />
              </span>
              <span>{config.description}</span>
            </Link>
          );
        })}
        <Link className="mode-choice" href="/multi">
          <span className="mode-choice-top">
            <span className="mode-icon">
              <Users size={22} aria-hidden="true" />
            </span>
            <small className="mode-state muted">暂未开放</small>
          </span>
          <span className="mode-title">
            <strong>多人大厅</strong>
            <ArrowRight size={20} aria-hidden="true" />
          </span>
          <span>与好友在同一个房间中共同推理。</span>
        </Link>
        <Link className="mode-choice" href="/multi/room">
          <span className="mode-choice-top">
            <span className="mode-icon">
              <Shield size={22} aria-hidden="true" />
            </span>
            <small className="mode-state muted">暂未开放</small>
          </span>
          <span className="mode-title">
            <strong>多人房间</strong>
            <ArrowRight size={20} aria-hidden="true" />
          </span>
          <span>通过房间码加入已创建的对局。</span>
        </Link>
      </div>
    </section>
  );
}
