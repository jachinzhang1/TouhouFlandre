export type HairColor =
  | "black"
  | "brown"
  | "blonde"
  | "white"
  | "silver"
  | "red"
  | "pink"
  | "purple"
  | "blue"
  | "green"
  | "orange"
  | "gray"
  | "multicolor"
  | "other";

export type WorkType = "game" | "print" | "music_cd" | "other";
export type DifficultyTier = "easy" | "normal" | "hard" | "lunatic";
export type GameMode = "daily" | "random" | "multiplayer";
export type SessionStatus = "playing" | "won" | "lost";

export type FeedbackStatus = "exact" | "partial" | "miss" | "higher" | "lower" | "unknown";

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

export type Work = {
  id: string;
  titleZh: string;
  titleJa: string;
  titleEn?: string;
  shortName: string;
  type: WorkType;
  releaseYear: number;
  mainlineIndex?: number;
  era?: "pc98" | "windows" | "other";
};

export type GuessFieldKey =
  | "firstAppearance"
  | "releaseYear"
  | "species"
  | "abilityTags"
  | "affiliations"
  | "locations"
  | "roles"
  | "hairColors";

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
  isCorrect: boolean;
  feedback: FieldFeedback[];
};

export type PublicGameSession = {
  id: string;
  mode: GameMode;
  status: SessionStatus;
  maxGuesses: number;
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
  hairColors: HairColor[];
};
