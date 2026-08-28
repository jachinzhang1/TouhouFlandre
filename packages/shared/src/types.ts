import type { QuestionScopeConfig } from "./questionScope";

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
  "none",
] as const;
export type HairColor = (typeof HAIR_COLORS)[number];
export const WORK_TYPES = [
  "game",
  "ftg",
  "stg",
  "print",
  "music_cd",
  "other",
] as const;
export type WorkType = (typeof WORK_TYPES)[number];
export const DIFFICULTY_TIERS = [
  "easy",
  "normal",
  "hard",
  "lunatic",
  "extra",
] as const;
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
  workPinyinInitials?: string[];
};

export type Work = {
  id: string;
  titleZh: string;
  titleJa: string;
  titleEn?: string;
  shortName: string;
  pinyinInitials: string[];
  type: WorkType;
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

export type GuessFieldKey = string;

export type GuessField = {
  key: GuessFieldKey;
  label: string;
  type: "string" | "enum" | "multi_enum" | "number" | "hierarchy";
  visible: boolean;
  compareStrategy: string;
  helpText?: string;
};

export type GuessFieldModeDefinition = {
  key: string;
  label: string;
  enabled: boolean;
};

export type GuessFieldDefinition = {
  key: GuessFieldKey;
  label: string;
  type: GuessField["type"];
  helpText?: string;
  configurable: boolean;
  defaultMode: string;
  modes: GuessFieldModeDefinition[];
  equivalence: boolean;
};

export type MatchKind = "none" | "exact" | "equivalent";

export type FieldFeedback = {
  field: GuessFieldKey;
  label: string;
  status: FeedbackStatus;
  symbol: "O" | "~" | "X" | "↑" | "↓" | "?";
  displayValue: string[];
};

export type GuessResult = {
  kind?: "guess" | "timeout";
  guessId: string;
  guessName: string;
  guessAvatarUrl?: string;
  isCorrect: boolean;
  /** Missing only on legacy persisted records. */
  matchKind?: MatchKind;
  feedback: FieldFeedback[];
};

export type PublicGameSession = {
  id: string;
  mode: GameMode;
  contentType: GameContentType;
  status: SessionStatus;
  maxGuesses: number;
  catalogVersion?: string;
  questionScope?: QuestionScopeConfig;
  activeFields?: GuessField[];
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
  workId: string;
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
  version?: string;
  dailyDateKey: string;
  contents: CatalogContentSummary[];
  works: Work[];
};

export type CatalogSearchIndexEntry = Omit<
  CharacterSearchResult,
  "searchText"
> & {
  searchTerms: string[];
};

export type CatalogSearchIndex = {
  catalogVersion: string;
  indexSchemaVersion: number;
  entries: CatalogSearchIndexEntry[];
};

export type CharacterSearchPolicy = {
  mode: "remote" | "local-primary";
  indexSchemaVersion: number;
  revision: string;
  gameScopeMode: "strict" | "full";
  revalidateAfterSeconds: 60;
};
