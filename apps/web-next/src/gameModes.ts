import { CalendarDays, Shuffle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  SINGLE_PLAYER_GAME_MODES,
  SINGLE_PLAYER_MODE_DEFINITIONS,
} from "@touhoufriberg/shared";
import type { SinglePlayerGameMode } from "@touhoufriberg/shared";

export const SINGLE_PLAYER_MODE_IDS = SINGLE_PLAYER_GAME_MODES;

export const modeConfig: Record<
  SinglePlayerGameMode,
  {
    label: string;
    puzzleLabel: string;
    eyebrow: string;
    description: string;
    stateLabel: string;
    stateClass: string;
    icon: LucideIcon;
    storageKey: string;
  }
> = {
  daily: {
    ...SINGLE_PLAYER_MODE_DEFINITIONS.daily,
    eyebrow: "DAILY PUZZLE",
    description: "所有玩家每天面对同一个隐藏角色。",
    stateLabel: "今日可玩",
    stateClass: "live",
    icon: CalendarDays,
    storageKey: "touhoufriberg:daily-session",
  },
  random: {
    ...SINGLE_PLAYER_MODE_DEFINITIONS.random,
    eyebrow: "RANDOM PUZZLE",
    description: "从当前题库中随机抽取角色。",
    stateLabel: "不限次数",
    stateClass: "",
    icon: Shuffle,
    storageKey: "touhoufriberg:random-session",
  },
};
