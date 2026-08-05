import type { LucideIcon } from "lucide-react";

export function PlaceholderPage({
  title,
  eyebrow,
  text,
  icon: Icon,
}: {
  title: string;
  eyebrow: string;
  text: string;
  icon: LucideIcon;
}) {
  return (
    <section className="px-[18px] pt-12 pb-6 max-[680px]:px-[18px] max-[680px]:pt-[34px] max-[680px]:pb-[18px]">
      <div className="flex min-h-[460px] items-start gap-[22px] pt-[110px] max-[680px]:grid max-[680px]:min-h-[410px] max-[680px]:pt-[70px] max-[420px]:grid">
        <span className="inline-flex size-[58px] shrink-0 items-center justify-center rounded-[6px] bg-vermilion-soft text-vermilion">
          <Icon size={28} aria-hidden="true" />
        </span>
        <div className="max-w-[560px]">
          <p className="mt-0 mb-2 text-[0.69rem] font-black tracking-[0.12em] text-vermilion">
            {eyebrow}
          </p>
          <h1 className="mt-0 mb-0 font-brand text-[2.6rem] leading-[1.15] max-[680px]:text-[2.05rem]">
            {title}
          </h1>
          <p className="mt-3 mb-0 leading-[1.75] text-ink-soft">{text}</p>
          <span className="mt-[22px] inline-flex min-h-[25px] items-center rounded-full border border-line bg-paper-muted px-[9px] text-[0.68rem] font-extrabold text-ink-soft">
            暂未开放
          </span>
        </div>
      </div>
    </section>
  );
}
