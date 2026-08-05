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
    <section className="page-panel placeholder">
      <span className="placeholder-icon">
        <Icon size={28} aria-hidden="true" />
      </span>
      <div className="page-heading compact">
        <p className="kicker">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{text}</p>
        <span className="availability">暂未开放</span>
      </div>
    </section>
  );
}
