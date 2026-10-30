import { CalendarDays, Shuffle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  SINGLE_PLAYER_GAME_MODES,
  SINGLE_PLAYER_MODE_DEFINITIONS,
} from "@touhouflandre/shared";
import type { SinglePlayerGameMode } from "@touhouflandre/shared";

export const SINGLE_PLAYER_MODE_IDS = SINGLE_PLAYER_GAME_MODES;

export const modeConfig: Record<
  SinglePlayerGameMode,
  {
    label: string;
    puzzleLabel: string;
    description: string;
    icon: LucideIcon;
    storageKey: string;
  }
> = {
  daily: {
    ...SINGLE_PLAYER_MODE_DEFINITIONS.daily,
    description: "所有玩家每天面对同一个隐藏角色。",
    icon: CalendarDays,
    storageKey: "touhouflandre:daily-session",
  },
  random: {
    ...SINGLE_PLAYER_MODE_DEFINITIONS.random,
    description: "从当前题库中随机抽取角色。",
    icon: Shuffle,
    storageKey: "touhouflandre:random-session",
  },
};
