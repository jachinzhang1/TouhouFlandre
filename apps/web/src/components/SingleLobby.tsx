import Link from "next/link";
import { ArrowRight, Shield, Users } from "lucide-react";
import { modeConfig, SINGLE_PLAYER_MODE_IDS } from "../gameModes";

export function SingleLobby() {
  return (
    <section className="px-[18px] pt-12 pb-6 max-[680px]:pt-[34px] max-[680px]:pb-[18px]">
      <div className="max-w-[720px]">
        <p className="mt-0 mb-2 text-[0.69rem] font-black tracking-[0.12em] text-vermilion">
          PLAY
        </p>
        <h1 className="mt-0 mb-0 font-brand text-[2.6rem] leading-[1.15] max-[680px]:text-[2.05rem]">
          游戏模式
        </h1>
        <p className="mt-3 mb-0 leading-[1.75] text-ink-soft">
          选择一局，沿着角色留下的线索抵达答案。
        </p>
      </div>
      <div className="mt-[34px] grid grid-cols-2 gap-[14px] max-[680px]:mt-[26px] max-[680px]:grid-cols-1">
        {SINGLE_PLAYER_MODE_IDS.map((modeId) => {
          const config = modeConfig[modeId];
          const Icon = config.icon;
          return (
            <Link
              className="group grid min-h-[205px] gap-4 rounded-[6px] border border-line bg-paper p-[23px] text-left text-ink no-underline shadow-sm transition-[border-color,box-shadow,transform] duration-180 hover:-translate-y-[3px] hover:border-[#af7a72] hover:shadow-lg max-[680px]:min-h-[185px]"
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
                      ? "border-[#b7d9d1] bg-jade-soft text-[#176256]"
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
          className="group grid min-h-[205px] gap-4 rounded-[6px] border border-line bg-paper p-[23px] text-left text-ink no-underline shadow-sm transition-[border-color,box-shadow,transform] duration-180 hover:-translate-y-[3px] hover:border-[#af7a72] hover:shadow-lg max-[680px]:min-h-[185px]"
          href="/multi"
        >
          <span className="flex items-center justify-between gap-3">
            <span className="inline-flex size-[46px] shrink-0 items-center justify-center rounded-[4px] bg-vermilion-soft text-vermilion">
              <Users size={22} aria-hidden="true" />
            </span>
            <small className="inline-flex min-h-[25px] items-center rounded-full border border-line bg-paper-muted px-[9px] text-[0.68rem] font-extrabold text-[#727d79]">
              暂未开放
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
        <Link
          className="group grid min-h-[205px] gap-4 rounded-[6px] border border-line bg-paper p-[23px] text-left text-ink no-underline shadow-sm transition-[border-color,box-shadow,transform] duration-180 hover:-translate-y-[3px] hover:border-[#af7a72] hover:shadow-lg max-[680px]:min-h-[185px]"
          href="/multi"
        >
          <span className="flex items-center justify-between gap-3">
            <span className="inline-flex size-[46px] shrink-0 items-center justify-center rounded-[4px] bg-vermilion-soft text-vermilion">
              <Shield size={22} aria-hidden="true" />
            </span>
            <small className="inline-flex min-h-[25px] items-center rounded-full border border-line bg-paper-muted px-[9px] text-[0.68rem] font-extrabold text-[#727d79]">
              暂未开放
            </small>
          </span>
          <span className="flex items-center justify-between gap-3">
            <strong className="font-[Noto_Serif_SC,Songti_SC,serif] text-[1.35rem]">
              多人房间
            </strong>
            <ArrowRight
              className="text-vermilion transition-transform duration-160 group-hover:translate-x-1"
              size={20}
              aria-hidden="true"
            />
          </span>
          <span className="leading-[1.6] text-ink-soft">
            通过房间码加入已创建的对局。
          </span>
        </Link>
      </div>
    </section>
  );
}
