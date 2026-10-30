import type { ReactNode } from "react";

type VisualAlignEdge = "start" | "end" | "responsive" | "mobile-start";
export type VisualAlignInset =
  "icon-button" | "leading-icon-action" | "inline-link" | "padded-label";

export function VisualAlign({
  as = "div",
  children,
  className = "",
  edge,
  inset,
}: {
  as?: "div" | "span";
  children: ReactNode;
  className?: string;
  edge: VisualAlignEdge;
  inset: VisualAlignInset;
}) {
  const Component = as;
  return (
    <Component
      className={["visual-align", className].filter(Boolean).join(" ")}
      data-visual-align-edge={edge}
      data-visual-align-inset={inset}
    >
      {children}
    </Component>
  );
}
