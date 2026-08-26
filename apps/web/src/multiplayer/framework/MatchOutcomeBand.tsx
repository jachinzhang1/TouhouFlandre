import type { ReactNode } from "react";

export function MatchOutcomeBand({
  eyebrow,
  title,
  detail,
  tone = "default",
  children,
}: {
  eyebrow: string;
  title: string;
  detail?: ReactNode;
  tone?: "default" | "success" | "danger" | "warning";
  children?: ReactNode;
}) {
  const toneClass =
    tone === "success"
      ? "border-jade bg-jade-soft"
      : tone === "danger"
        ? "border-vermilion bg-vermilion-soft"
        : tone === "warning"
          ? "border-amber bg-amber-soft"
          : "border-line bg-paper";
  const textClass =
    tone === "success"
      ? "text-jade"
      : tone === "danger"
        ? "text-vermilion"
        : tone === "warning"
          ? "text-amber"
          : "text-ink";
  return (
    <section
      className={`mb-3 border-y px-3 py-3 ${toneClass}`}
      data-match-outcome
      aria-labelledby="multiplayer-round-outcome"
    >
      <p className={`m-0 text-[0.68rem] font-black ${textClass}`}>{eyebrow}</p>
      <div className="mt-1 flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <h2
          id="multiplayer-round-outcome"
          className={`m-0 text-[0.9rem] font-black ${textClass}`}
        >
          {title}
        </h2>
        {detail ? (
          <div className="text-[0.72rem] text-ink-soft">{detail}</div>
        ) : null}
      </div>
      {children}
    </section>
  );
}
