export const HAIR_COLORS = [
  "black",
  "brown",
  "blonde",
  "white",
  "silver",
  "red",
  "pink",
  "purple",
  "blue",
  "green",
  "orange",
  "gray",
  "multicolor",
  "other",
] as const;
export type HairColor = (typeof HAIR_COLORS)[number];
export const WORK_TYPES = ["game", "print", "music_cd", "other"] as const;
export type WorkType = (typeof WORK_TYPES)[number];
export const DIFFICULTY_TIERS = ["easy", "normal", "hard", "lunatic"] as const;
export type DifficultyTier = (typeof DIFFICULTY_TIERS)[number];
export const SINGLE_PLAYER_GAME_MODES = ["daily", "random"] as const;
export type SinglePlayerGameMode = (typeof SINGLE_PLAYER_GAME_MODES)[number];
export type GameMode = SinglePlayerGameMode | "multiplayer";
export const GAME_CONTENT_TYPES = ["character"] as const;
export type GameContentType = (typeof GAME_CONTENT_TYPES)[number];
export const SESSION_STATUSES = ["playing", "won", "lost"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export const CHARACTER_SORTS = ["name", "appearance"] as const;
export type CharacterSort = (typeof CHARACTER_SORTS)[number];
export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export const FEEDBACK_STATUSES = [
  "exact",
  "partial",
  "miss",
  "higher",
  "lower",
  "unknown",
] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export type LocalizedNames = {
  zhHans: string;
  zhHant?: string;
  ja: string;
  en: string;
  romaji?: string;
  aliases: string[];
};

export type FirstAppearance = {
  workId: string;
  workTitle: string;
  workType: WorkType;
  releaseYear: number;
  mainlineIndex?: number;
  era?: "pc98" | "windows" | "other";
};

export type Character = {
  id: string;
  avatarUrl: string;
  appearanceOrder: number;
  names: LocalizedNames;
  firstAppearance: FirstAppearance;
  species: string[];
  abilityDisplay: string;
  abilityTags: string[];
  affiliations: string[];
  locations: string[];
  roles: string[];
  hairColors: HairColor[];
  playable: boolean;
  enabledAsAnswer: boolean;
  enabledAsGuess: boolean;
  difficultyTier: DifficultyTier;
  sourceRefs: string[];
};

export const GUESS_FIELD_KEYS = [
  "firstAppearance",
  "releaseYear",
  "species",
  "abilityTags",
  "affiliations",
  "locations",
  "roles",
  "hairColors",
] as const;
export type GuessFieldKey = (typeof GUESS_FIELD_KEYS)[number];

export type GuessField = {
  key: GuessFieldKey;
  label: string;
  type: "string" | "enum" | "multi_enum" | "number" | "hierarchy";
  visible: boolean;
  compareStrategy: "firstAppearance" | "numberDirection" | "multiSet";
  helpText?: string;
};

export type FieldFeedback = {
  field: GuessFieldKey;
  label: string;
  status: FeedbackStatus;
  symbol: "O" | "~" | "X" | "↑" | "↓" | "?";
  displayValue: string[];
};

export type GuessResult = {
  guessId: string;
  guessName: string;
  guessAvatarUrl?: string;
  isCorrect: boolean;
  feedback: FieldFeedback[];
};

export type PublicGameSession = {
  id: string;
  mode: GameMode;
  contentType: GameContentType;
  status: SessionStatus;
  maxGuesses: number;
  catalogVersion?: string;
  puzzleKey?: string;
  guesses: GuessResult[];
  startedAt: string;
  endedAt?: string;
  answer?: Character;
};

export type CharacterSearchResult = {
  id: string;
  name: string;
  subtitle: string;
  initials: string;
  avatarUrl: string;
  appearanceOrder: number;
  searchText: string;
  nameSortKey: string;
  firstAppearance: Pick<FirstAppearance, "workTitle" | "releaseYear">;
  species: string[];
  locations: string[];
  affiliations: string[];
  hairColors: HairColor[];
};

export type CharacterSearchResponse = {
  results: CharacterSearchResult[];
  total: number;
};

export type CatalogContentSummary = {
  contentType: GameContentType;
  label: string;
  total: number;
  guessable: number;
  answerable: number;
  maxGuesses: number;
  visibleFieldCount: number;
};

export type CatalogSummary = {
  dailyDateKey: string;
  contents: CatalogContentSummary[];
};
