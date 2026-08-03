import type { GuessField, HairColor, WorkType } from "./types";

export const CHARACTER_GUESS_FIELDS: GuessField[] = [
  {
    key: "firstAppearance",
    label: "初登场作品",
    type: "hierarchy",
    visible: true,
    compareStrategy: "firstAppearance",
    helpText: "具体作品相同为命中，同类媒介为部分匹配。",
  },
  {
    key: "releaseYear",
    label: "初登场年份",
    type: "number",
    visible: true,
    compareStrategy: "numberDirection",
    helpText: "箭头指向答案所在年份。",
  },
  {
    key: "species",
    label: "种族",
    type: "multi_enum",
    visible: true,
    compareStrategy: "multiSet",
  },
  {
    key: "affiliations",
    label: "阵营",
    type: "multi_enum",
    visible: true,
    compareStrategy: "multiSet",
  },
  {
    key: "locations",
    label: "地点",
    type: "multi_enum",
    visible: true,
    compareStrategy: "multiSet",
  },
  {
    key: "hairColors",
    label: "头发颜色",
    type: "multi_enum",
    visible: true,
    compareStrategy: "multiSet",
  },
];

export const GAME_CONTENT_DEFINITIONS = {
  character: {
    label: "角色",
    maxGuesses: 8,
    fields: CHARACTER_GUESS_FIELDS,
  },
} as const;

// Kept as a compatibility export for existing consumers.
export const GUESS_FIELDS = CHARACTER_GUESS_FIELDS;

export const HAIR_COLOR_LABELS: Record<HairColor, string> = {
  black: "黑",
  brown: "棕",
  blonde: "金",
  white: "白",
  silver: "银",
  red: "红",
  pink: "粉",
  purple: "紫",
  blue: "蓝",
  green: "绿",
  orange: "橙",
  gray: "灰",
  multicolor: "多色",
  other: "其他",
};

export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  game: "游戏",
  print: "书籍/漫画",
  music_cd: "音乐 CD",
  other: "其他",
};
