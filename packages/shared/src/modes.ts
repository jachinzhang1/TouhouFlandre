import type { GameContentType, SinglePlayerGameMode } from "./types";

export type SinglePlayerModeDefinition = {
  id: SinglePlayerGameMode;
  label: string;
  puzzleLabel: string;
  contentType: GameContentType;
};

export const SINGLE_PLAYER_MODE_DEFINITIONS: Record<
  SinglePlayerGameMode,
  SinglePlayerModeDefinition
> = {
  daily: {
    id: "daily",
    label: "每日题",
    puzzleLabel: "今日每日题",
    contentType: "character",
  },
  random: {
    id: "random",
    label: "随机题",
    puzzleLabel: "随机题",
    contentType: "character",
  },
};

export const isSinglePlayerGameMode = (
  value: string,
): value is SinglePlayerGameMode => value in SINGLE_PLAYER_MODE_DEFINITIONS;
