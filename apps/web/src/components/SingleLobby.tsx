import Link from "next/link";
import { ArrowRight, Users } from "lucide-react";
import { modeConfig, SINGLE_PLAYER_MODE_IDS } from "../gameModes";

export function SingleLobby() {
  return (
    <section className="px-[18px] pt-12 pb-6 max-[680px]:pt-[34px] max-[680px]:pb-[18px]">
      <div className="max-w-[720px]">
        <p className="mt-0 mb-2 text-[0.69rem] font-black tracking-[0.12em] text-vermilion">
          PLAY
        </p>
        <h1 className="mt-0 mb-0 font-brand text-[2.6rem] font-bold leading-[1.15] max-[680px]:text-[2.05rem]">
          游戏模式
        </h1>
        <p className="mt-3 mb-0 leading-[1.75] text-ink-soft">
          选择一局，沿着角色留下的线索抵达答案。
        </p>
      </div>
      <div className="mt-[34px] grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-[14px] max-[680px]:mt-[26px] max-[680px]:grid-cols-1">
        {SINGLE_PLAYER_MODE_IDS.map((modeId) => {
          const config = modeConfig[modeId];
          const Icon = config.icon;
          return (
            <Link
              className="group grid min-h-[205px] gap-4 rounded-[6px] border border-line bg-paper p-[23px] text-left text-ink no-underline shadow-sm transition-[border-color,box-shadow,transform] duration-180 hover:-translate-y-[3px] hover:border-[var(--accent-hover-border)] hover:shadow-lg max-[680px]:min-h-[185px]"
              key={modeId}
              href={`/single/${modeId}`}
            >
              <span className="flex items-center justify-between gap-3">
                <span className="inline-flex size-[46px] shrink-0 items-center justify-center rounded-[4px] bg-vermilion-soft text-vermilion">
                  <Icon size={22} aria-hidden="true" />
                </span>
                <small
                  className={`inline-flex min-h-[25px] items-center rounded-full border border-line bg-paper-muted px-[9px] text-[0.68rem] font-extrabold ${
                    config.stateClass === "live"
                      ? "border-[var(--jade-border)] bg-jade-soft text-[var(--jade-strong)]"
                      : "text-ink-soft"
                  }`}
                >
                  {config.stateLabel}
                </small>
              </span>
              <span className="flex items-center justify-between gap-3">
                <strong className="font-[Noto_Serif_SC,Songti_SC,serif] text-[1.35rem]">
                  {config.label}
                </strong>
                <ArrowRight
                  className="text-vermilion transition-transform duration-160 group-hover:translate-x-1"
                  size={20}
                  aria-hidden="true"
                />
              </span>
              <span className="leading-[1.6] text-ink-soft">
                {config.description}
              </span>
            </Link>
          );
        })}
        <Link
          className="group grid min-h-[205px] gap-4 rounded-[6px] border border-line bg-paper p-[23px] text-left text-ink no-underline shadow-sm transition-[border-color,box-shadow,transform] duration-180 hover:-translate-y-[3px] hover:border-[var(--accent-hover-border)] hover:shadow-lg max-[680px]:min-h-[185px]"
          href="/multi"
        >
          <span className="flex items-center justify-between gap-3">
            <span className="inline-flex size-[46px] shrink-0 items-center justify-center rounded-[4px] bg-vermilion-soft text-vermilion">
              <Users size={22} aria-hidden="true" />
            </span>
            <small className="inline-flex min-h-[25px] items-center rounded-full border border-[var(--jade-border)] bg-jade-soft px-[9px] text-[0.68rem] font-extrabold text-[var(--jade-strong)]">
              已开放
            </small>
          </span>
          <span className="flex items-center justify-between gap-3">
            <strong className="font-[Noto_Serif_SC,Songti_SC,serif] text-[1.35rem]">
              多人大厅
            </strong>
            <ArrowRight
              className="text-vermilion transition-transform duration-160 group-hover:translate-x-1"
              size={20}
              aria-hidden="true"
            />
          </span>
          <span className="leading-[1.6] text-ink-soft">
            与好友在同一个房间中共同推理。
          </span>
        </Link>
      </div>
    </section>
  );
}
