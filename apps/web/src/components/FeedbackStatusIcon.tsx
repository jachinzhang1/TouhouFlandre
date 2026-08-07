import {
  Check,
  ChevronsDown,
  ChevronsUp,
  Minus,
  X,
} from "lucide-react";
import type { FeedbackStatus } from "@touhouflandre/shared";

const ICON_LABEL: Record<FeedbackStatus, string> = {
  exact: "完全匹配",
  partial: "部分匹配",
  miss: "不匹配",
  higher: "答案更晚",
  lower: "答案更早",
  unknown: "不匹配",
};

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
  if (status === "partial") return <Minus size={size} {...accessibilityProps} />;
  if (status === "higher")
    return <ChevronsUp size={size} {...accessibilityProps} />;
  if (status === "lower")
    return <ChevronsDown size={size} {...accessibilityProps} />;
  return <X size={size} {...accessibilityProps} />;
}
