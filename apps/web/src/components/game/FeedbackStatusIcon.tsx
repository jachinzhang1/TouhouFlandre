import { Check, ChevronsDown, ChevronsUp, Slash, X } from "lucide-react";
import type { HTMLAttributes, SVGProps } from "react";
import type { FeedbackStatus } from "@touhouflandre/shared";

const ICON_LABEL: Record<FeedbackStatus, string> = {
  exact: "完全匹配",
  partial: "部分匹配",
  miss: "不匹配",
  higher: "答案更晚",
  lower: "答案更早",
  unknown: "无法判断",
};

function QuestionMarkIcon({
  size,
  ...props
}: {
  size: number;
} & SVGProps<SVGSVGElement>) {
  return (
    <svg
      className="feedback-question-mark-icon"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.4"
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M9.1 9a3 3 0 1 1 5.8 1c-.28.84-.92 1.34-1.74 1.98C12.41 12.57 12 12.97 12 14" />
      <path d="M12 18h.01" />
    </svg>
  );
}

function SlashedCheckIcon({
  size,
  ...props
}: {
  size: number;
} & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className="feedback-slashed-check-icon"
      style={{ width: size, height: size }}
      {...props}
    >
      <Check aria-hidden="true" size={size} strokeWidth={2.4} />
      <Slash
        aria-hidden="true"
        size={size}
        strokeWidth={2.4}
        style={{
          transform: "translate(1px, -1px) scaleX(-1) scale(0.68)",
          transformOrigin: "center",
        }}
      />
    </span>
  );
}

export function FeedbackStatusIcon({
  status,
  decorative = false,
  size = 14,
}: {
  status: FeedbackStatus;
  decorative?: boolean;
  size?: number;
}) {
  const accessibilityProps = decorative
    ? { "aria-hidden": true as const }
    : { "aria-label": ICON_LABEL[status] };

  if (status === "exact") return <Check size={size} {...accessibilityProps} />;
  if (status === "partial")
    return <SlashedCheckIcon size={size} {...accessibilityProps} />;
  if (status === "higher")
    return <ChevronsUp size={size} {...accessibilityProps} />;
  if (status === "lower")
    return <ChevronsDown size={size} {...accessibilityProps} />;
  if (status === "unknown")
    return <QuestionMarkIcon size={size} {...accessibilityProps} />;
  return <X size={size} {...accessibilityProps} />;
}
