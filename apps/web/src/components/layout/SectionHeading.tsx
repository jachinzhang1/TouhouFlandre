import type { ReactNode } from "react";

export function SectionHeading({
  action,
  className = "",
  description,
  title,
  titleAs = "h2",
}: {
  action?: ReactNode;
  className?: string;
  description?: ReactNode;
  title: ReactNode;
  titleAs?: "div" | "h2";
}) {
  const Title = titleAs;
  return (
    <header
      className={["section-heading", className].filter(Boolean).join(" ")}
    >
      <div className="section-heading-title-row">
        <span className="section-heading-rule" aria-hidden="true" />
        <Title className="section-heading-title">{title}</Title>
        <span
          className="section-heading-rule section-heading-rule-right"
          aria-hidden="true"
        />
      </div>
      {description ? (
        <p className="section-heading-description">{description}</p>
      ) : null}
      {action ? <div className="section-heading-action">{action}</div> : null}
    </header>
  );
}
