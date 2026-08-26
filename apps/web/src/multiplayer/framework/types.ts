import type { ReactNode } from "react";
import type { MemberScoreStripEntry } from "../../components/MemberScoreStrip";

export interface MatchSummaryModel {
  identityLabel: string;
  scoreEntries: readonly MemberScoreStripEntry[];
  progressLabel: string;
  indicators?: ReactNode;
}

export interface MatchStatusTimer {
  label: string;
  deadline?: string | null;
  value?: string;
}

export interface MatchStatusModel {
  message: string;
  timers?: readonly MatchStatusTimer[];
  active?: boolean;
  tone?: "default" | "accent" | "warning" | "success" | "danger";
}

export interface BoardBrowserOption {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface BoardBrowserModel {
  ariaLabel: string;
  returnLabel: string;
  currentScopeId: string;
  selectedScopeId: string;
  scopeLabel: string;
  scopeOptions: readonly BoardBrowserOption[];
  boardLabel?: string;
  boardOptions?: readonly BoardBrowserOption[];
  selectedBoardId?: string;
  trailing?: ReactNode;
}

export interface MatchRankingEntry {
  id: string;
  rank?: number;
  rankLabel?: string;
  order?: number;
  label: string;
  scoreLabel: string;
  isViewer?: boolean;
}
