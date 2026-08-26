import type { Character, DifficultyTier, GuessFieldKey, Work } from "./types";

export const QUESTION_SCOPE_SCHEMA_VERSION = 2 as const;
export const QUESTION_SCOPE_MIN_TURN_SECONDS = 30;
export const QUESTION_SCOPE_HARD_TURN_SECONDS = 45;
export const QUESTION_SCOPE_MAX_TURN_SECONDS = 120;
export const QUESTION_SCOPE_MIN_GUESSES = 1;
export const QUESTION_SCOPE_DEFAULT_GUESSES = 8;
export const QUESTION_SCOPE_MAX_GUESSES = 20;
export const QUESTION_SCOPE_UNLIMITED_GUESSES = 999;

export const QUESTION_SCOPE_CONFIGURABLE_FIELDS = [
  "firstAppearance",
  "releaseYear",
  "species",
  "affiliations",
  "locations",
  "hairColors",
] as const;

export type QuestionScopeMode = "preset" | "custom";
export type QuestionScopeWorkSelection = "all" | "partial" | "none";
export type QuestionScopeConfigurableField =
  (typeof QUESTION_SCOPE_CONFIGURABLE_FIELDS)[number];
export type QuestionScopeReleaseYearMode =
  "hidden" | "exactOnly" | "directional";
export type QuestionScopeGuessLimit = {
  enabled: boolean;
  maxGuesses: number;
};

export type QuestionScopeRules = {
  fields: {
    firstAppearance: boolean;
    releaseYear: QuestionScopeReleaseYearMode;
    species: boolean;
    affiliations: boolean;
    locations: boolean;
    hairColors: boolean;
  };
  turnLimit: {
    enabled: boolean;
    seconds: number;
  };
  guessLimit: QuestionScopeGuessLimit;
  /** Legacy v1 input. Normalized configs do not write this field. */
  hiddenFields?: GuessFieldKey[];
  /** Legacy v1 input. Normalized configs do not write this field. */
  turnSeconds?: number;
};

export type QuestionScopeWorkState = {
  workId: string;
  state: QuestionScopeWorkSelection;
  selectedCount: number;
  totalCount: number;
};

export type QuestionScopeConfig = {
  schemaVersion: typeof QUESTION_SCOPE_SCHEMA_VERSION;
  catalogVersion: string;
  mode: QuestionScopeMode;
  difficulty: QuestionDifficulty;
  selectedCharacterIds: string[];
  workStates: QuestionScopeWorkState[];
  rules: QuestionScopeRules;
};

export type QuestionScopeConfigInput = Partial<
  Omit<QuestionScopeConfig, "rules" | "schemaVersion">
> & {
  schemaVersion?: number;
  rules?: Partial<QuestionScopeRules>;
};

export type FullCatalogSnapshot = {
  version: string;
  works: Work[];
  characters: Character[];
};

export type QuestionScopeCorrection = {
  config: QuestionScopeConfig;
  changed: boolean;
  reason?: "catalog-updated" | "invalid-ids-dropped" | "empty-pool-fallback";
};

const allFieldsEnabled: QuestionScopeRules["fields"] = {
  firstAppearance: true,
  releaseYear: "directional",
  species: true,
  affiliations: true,
  locations: true,
  hairColors: true,
};

const defaultTurnLimit: QuestionScopeRules["turnLimit"] = {
  enabled: false,
  seconds: QUESTION_SCOPE_MIN_TURN_SECONDS,
};

const defaultGuessLimit: QuestionScopeGuessLimit = {
  enabled: true,
  maxGuesses: QUESTION_SCOPE_DEFAULT_GUESSES,
};

const unlimitedGuessLimit: QuestionScopeGuessLimit = {
  enabled: false,
  maxGuesses: QUESTION_SCOPE_DEFAULT_GUESSES,
};

type QuestionDifficultyPresetDefinition = {
  label: string;
  description: string;
  includedDifficultyTiers: "all" | readonly DifficultyTier[];
  rules: QuestionScopeRules;
};

export const QUESTION_DIFFICULTY_PRESET_DEFINITIONS = {
  easy: {
    label: "Easy",
    description: "仅包含高人气整数作角色，不限制猜测次数",
    includedDifficultyTiers: ["easy"],
    rules: {
      fields: allFieldsEnabled,
      turnLimit: defaultTurnLimit,
      guessLimit: unlimitedGuessLimit,
    },
  },
  normal: {
    label: "Normal",
    description:
      "包含官作（游戏、出版物、音乐 CD）的部分高人气角色，限制 8 次猜测",
    includedDifficultyTiers: ["easy", "normal"],
    rules: {
      fields: allFieldsEnabled,
      turnLimit: defaultTurnLimit,
      guessLimit: defaultGuessLimit,
    },
  },
  hard: {
    label: "Hard",
    description:
      "包含所有官作角色，限制 8 次猜测，每手限时 45 秒",
    includedDifficultyTiers: ["easy", "normal", "hard"],
    rules: {
      fields: allFieldsEnabled,
      turnLimit: { enabled: true, seconds: QUESTION_SCOPE_HARD_TURN_SECONDS },
      guessLimit: defaultGuessLimit,
    },
  },
  lunatic: {
    label: "Lunatic",
    description: "禁用初登场作品属性，限制 8 次猜测，每手限时 30 秒",
    includedDifficultyTiers: ["easy", "normal", "hard", "lunatic"],
    rules: {
      fields: { ...allFieldsEnabled, firstAppearance: false },
      turnLimit: { enabled: true, seconds: QUESTION_SCOPE_MIN_TURN_SECONDS },
      guessLimit: defaultGuessLimit,
    },
  },
  extra: {
    label: "Extra",
    description: "包含仅在旧作中登场的角色",
    includedDifficultyTiers: "all",
    rules: {
      fields: { ...allFieldsEnabled, firstAppearance: false },
      turnLimit: { enabled: true, seconds: QUESTION_SCOPE_MIN_TURN_SECONDS },
      guessLimit: defaultGuessLimit,
    },
  },
} as const satisfies Record<string, QuestionDifficultyPresetDefinition>;

export type QuestionDifficultyPreset =
  keyof typeof QUESTION_DIFFICULTY_PRESET_DEFINITIONS;
export type QuestionDifficulty = QuestionDifficultyPreset | "custom";

export const QUESTION_DIFFICULTY_PRESETS = Object.keys(
  QUESTION_DIFFICULTY_PRESET_DEFINITIONS,
) as QuestionDifficultyPreset[];

export const DAILY_QUESTION_DIFFICULTY_PRESETS = [
  "easy",
  "normal",
  "hard",
  "lunatic",
] as const satisfies readonly QuestionDifficultyPreset[];
export type DailyQuestionDifficulty =
  (typeof DAILY_QUESTION_DIFFICULTY_PRESETS)[number];

export const QUESTION_DIFFICULTY_LABELS: Record<QuestionDifficulty, string> = {
  ...(Object.fromEntries(
    QUESTION_DIFFICULTY_PRESETS.map((preset) => [
      preset,
      QUESTION_DIFFICULTY_PRESET_DEFINITIONS[preset].label,
    ]),
  ) as Record<QuestionDifficultyPreset, string>),
  custom: "自定义",
};

export const QUESTION_DIFFICULTY_DESCRIPTIONS = Object.fromEntries(
  QUESTION_DIFFICULTY_PRESETS.map((preset) => [
    preset,
    QUESTION_DIFFICULTY_PRESET_DEFINITIONS[preset].description,
  ]),
) as Record<QuestionDifficultyPreset, string>;

const presetSet = new Set<string>(QUESTION_DIFFICULTY_PRESETS);

const isPreset = (value: unknown): value is QuestionDifficultyPreset =>
  typeof value === "string" && presetSet.has(value);

const answerableCharacters = (characters: Character[]) =>
  characters.filter((character) => character.enabledAsAnswer);

const sortByCatalogOrder = (characters: Character[]) =>
  [...characters].sort(
    (left, right) =>
      left.appearanceOrder - right.appearanceOrder ||
      left.id.localeCompare(right.id),
  );

export function presetQuestionScopeIds(
  preset: QuestionDifficultyPreset,
  characters: Character[],
): string[] {
  const includedTiers =
    QUESTION_DIFFICULTY_PRESET_DEFINITIONS[preset].includedDifficultyTiers;
  const pool = answerableCharacters(characters).filter((character) => {
    return (
      includedTiers === "all" ||
      (includedTiers as readonly DifficultyTier[]).includes(
        character.difficultyTier,
      )
    );
  });
  return sortByCatalogOrder(pool).map((character) => character.id);
}

export function questionScopePresetRules(
  preset: QuestionDifficultyPreset,
): QuestionScopeRules {
  const rules = QUESTION_DIFFICULTY_PRESET_DEFINITIONS[preset].rules;
  return {
    fields: { ...rules.fields },
    turnLimit: { ...rules.turnLimit },
    guessLimit: { ...rules.guessLimit },
  };
}

const releaseYearModes = new Set<QuestionScopeReleaseYearMode>([
  "hidden",
  "exactOnly",
  "directional",
]);

const clampTurnSeconds = (value: unknown): number => {
  const seconds =
    typeof value === "number" && Number.isFinite(value)
      ? Math.floor(value)
      : QUESTION_SCOPE_MIN_TURN_SECONDS;
  return Math.min(
    QUESTION_SCOPE_MAX_TURN_SECONDS,
    Math.max(QUESTION_SCOPE_MIN_TURN_SECONDS, seconds),
  );
};

const clampGuessLimit = (value: unknown): number => {
  const guesses =
    typeof value === "number" && Number.isFinite(value)
      ? Math.floor(value)
      : QUESTION_SCOPE_DEFAULT_GUESSES;
  return Math.min(
    QUESTION_SCOPE_MAX_GUESSES,
    Math.max(QUESTION_SCOPE_MIN_GUESSES, guesses),
  );
};

function normalizeQuestionScopeGuessLimit(
  guessLimit?: Partial<QuestionScopeGuessLimit>,
): QuestionScopeGuessLimit {
  return {
    enabled: guessLimit?.enabled === false ? false : true,
    maxGuesses: clampGuessLimit(guessLimit?.maxGuesses),
  };
}

export function normalizeQuestionScopeRules(
  rules?: Partial<QuestionScopeRules>,
): QuestionScopeRules {
  const fields = { ...allFieldsEnabled };
  const legacyHidden = new Set(
    Array.isArray(rules?.hiddenFields) ? rules.hiddenFields : [],
  );

  if (rules?.fields) {
    fields.firstAppearance = rules.fields.firstAppearance !== false;
    fields.releaseYear = releaseYearModes.has(rules.fields.releaseYear)
      ? rules.fields.releaseYear
      : "directional";
    fields.species = rules.fields.species !== false;
    fields.affiliations = rules.fields.affiliations !== false;
    fields.locations = rules.fields.locations !== false;
    fields.hairColors = rules.fields.hairColors !== false;
  } else {
    if (legacyHidden.has("firstAppearance")) fields.firstAppearance = false;
    if (legacyHidden.has("releaseYear")) fields.releaseYear = "hidden";
    if (legacyHidden.has("species")) fields.species = false;
    if (legacyHidden.has("affiliations")) fields.affiliations = false;
    if (legacyHidden.has("locations")) fields.locations = false;
    if (legacyHidden.has("hairColors")) fields.hairColors = false;
  }

  const legacyTurnSeconds =
    typeof rules?.turnSeconds === "number" && Number.isFinite(rules.turnSeconds)
      ? rules.turnSeconds
      : undefined;
  const hasTurnLimit = Boolean(rules?.turnLimit);
  const enabled = hasTurnLimit
    ? rules?.turnLimit?.enabled === true
    : legacyTurnSeconds !== undefined;
  const seconds = clampTurnSeconds(
    hasTurnLimit ? rules?.turnLimit?.seconds : legacyTurnSeconds,
  );

  return {
    fields,
    turnLimit: {
      enabled,
      seconds,
    },
    guessLimit: normalizeQuestionScopeGuessLimit(rules?.guessLimit),
  };
}

export function effectiveQuestionScopeMaxGuesses(
  rules?: Partial<QuestionScopeRules>,
): number {
  const guessLimit = normalizeQuestionScopeRules(rules).guessLimit;
  return guessLimit.enabled
    ? guessLimit.maxGuesses
    : QUESTION_SCOPE_UNLIMITED_GUESSES;
}

export function isUnlimitedGuessLimit(
  maxGuesses: number | null | undefined,
): boolean {
  return (maxGuesses ?? 0) >= QUESTION_SCOPE_UNLIMITED_GUESSES;
}

function rulesEqual(
  left: QuestionScopeRules,
  right: QuestionScopeRules,
): boolean {
  left = normalizeQuestionScopeRules(left);
  right = normalizeQuestionScopeRules(right);
  return (
    left.fields.firstAppearance === right.fields.firstAppearance &&
    left.fields.releaseYear === right.fields.releaseYear &&
    left.fields.species === right.fields.species &&
    left.fields.affiliations === right.fields.affiliations &&
    left.fields.locations === right.fields.locations &&
    left.fields.hairColors === right.fields.hairColors &&
    left.turnLimit.enabled === right.turnLimit.enabled &&
    (!left.turnLimit.enabled ||
      left.turnLimit.seconds === right.turnLimit.seconds) &&
    left.guessLimit.enabled === right.guessLimit.enabled &&
    left.guessLimit.maxGuesses === right.guessLimit.maxGuesses
  );
}

function sameIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((id, index) => id === right[index]);
}

function inferDifficulty(
  selectedCharacterIds: string[],
  rules: QuestionScopeRules,
  characters: Character[],
  preferredPreset?: QuestionDifficultyPreset,
): QuestionDifficulty {
  const matchesPreset = (preset: QuestionDifficultyPreset) =>
    sameIds(selectedCharacterIds, presetQuestionScopeIds(preset, characters)) &&
    rulesEqual(rules, questionScopePresetRules(preset));

  if (preferredPreset && matchesPreset(preferredPreset)) {
    return preferredPreset;
  }
  for (const preset of QUESTION_DIFFICULTY_PRESETS) {
    if (matchesPreset(preset)) {
      return preset;
    }
  }
  return "custom";
}

export function visibleQuestionFields<T extends { key: GuessFieldKey }>(
  rulesOrHiddenFields:
    Partial<QuestionScopeRules> | readonly GuessFieldKey[] | null | undefined,
  fields: readonly T[],
) {
  const rulesInput = rulesOrHiddenFields;
  const rules = Array.isArray(rulesInput)
    ? normalizeQuestionScopeRules({ hiddenFields: [...rulesInput] })
    : normalizeQuestionScopeRules(
        (rulesInput ?? undefined) as Partial<QuestionScopeRules> | undefined,
      );
  return fields.filter((field) => questionScopeFieldVisible(rules, field.key));
}

export function questionScopeFieldVisible(
  rules: Partial<QuestionScopeRules> | undefined,
  field: GuessFieldKey,
): boolean {
  const normalized = normalizeQuestionScopeRules(rules);
  switch (field) {
    case "firstAppearance":
      return normalized.fields.firstAppearance;
    case "releaseYear":
      return normalized.fields.releaseYear !== "hidden";
    case "species":
      return normalized.fields.species;
    case "affiliations":
      return normalized.fields.affiliations;
    case "locations":
      return normalized.fields.locations;
    case "hairColors":
      return normalized.fields.hairColors;
    default:
      return true;
  }
}

export function buildQuestionScopeWorkStates(
  works: Work[],
  characters: Character[],
  selectedCharacterIds: readonly string[],
): QuestionScopeWorkState[] {
  const selected = new Set(selectedCharacterIds);
  const totals = new Map<
    string,
    { selectedCount: number; totalCount: number }
  >();
  for (const character of characters) {
    if (!character.enabledAsAnswer) continue;
    const workId = character.firstAppearance.workId;
    const current = totals.get(workId) ?? { selectedCount: 0, totalCount: 0 };
    current.totalCount += 1;
    if (selected.has(character.id)) current.selectedCount += 1;
    totals.set(workId, current);
  }
  return works.map((work) => {
    const counts = totals.get(work.id) ?? { selectedCount: 0, totalCount: 0 };
    const state =
      counts.totalCount > 0 && counts.selectedCount === counts.totalCount
        ? "all"
        : counts.selectedCount > 0
          ? "partial"
          : "none";
    return { workId: work.id, state, ...counts };
  });
}

function normalizeSelectedIds(
  selectedIds: readonly string[],
  characters: Character[],
): string[] {
  const selected = new Set(selectedIds);
  return sortByCatalogOrder(answerableCharacters(characters))
    .filter((character) => selected.has(character.id))
    .map((character) => character.id);
}

function canonicalConfig(
  snapshot: FullCatalogSnapshot,
  selectedCharacterIds: string[],
  rules: QuestionScopeRules,
  preferredPreset?: QuestionDifficultyPreset,
): QuestionScopeConfig {
  const difficulty = inferDifficulty(
    selectedCharacterIds,
    rules,
    snapshot.characters,
    preferredPreset,
  );
  return {
    schemaVersion: QUESTION_SCOPE_SCHEMA_VERSION,
    catalogVersion: snapshot.version,
    mode: difficulty === "custom" ? "custom" : "preset",
    difficulty,
    selectedCharacterIds,
    workStates: buildQuestionScopeWorkStates(
      snapshot.works,
      snapshot.characters,
      selectedCharacterIds,
    ),
    rules: normalizeQuestionScopeRules(rules),
  };
}

export function defaultQuestionScope(
  snapshot: FullCatalogSnapshot,
  preset: QuestionDifficultyPreset = "normal",
): QuestionScopeConfig {
  return canonicalConfig(
    snapshot,
    presetQuestionScopeIds(preset, snapshot.characters),
    questionScopePresetRules(preset),
    preset,
  );
}

export function normalizeQuestionScope(
  input: QuestionScopeConfigInput | null | undefined,
  snapshot: FullCatalogSnapshot,
): QuestionScopeCorrection {
  if (!input) {
    return { config: defaultQuestionScope(snapshot), changed: true };
  }

  const requestedPreset = isPreset(input.difficulty)
    ? input.difficulty
    : undefined;
  let preferredPreset = requestedPreset;
  let requestedRules = input.rules
    ? normalizeQuestionScopeRules(input.rules)
    : requestedPreset
      ? questionScopePresetRules(requestedPreset)
      : questionScopePresetRules("normal");
  const catalogChanged = input.catalogVersion !== snapshot.version;
  const incomingIds =
    catalogChanged && input.mode === "preset" && requestedPreset
      ? presetQuestionScopeIds(requestedPreset, snapshot.characters)
      : Array.isArray(input.selectedCharacterIds)
        ? input.selectedCharacterIds
        : requestedPreset
          ? presetQuestionScopeIds(requestedPreset, snapshot.characters)
          : [];

  let selectedIds = normalizeSelectedIds(incomingIds, snapshot.characters);
  let reason: QuestionScopeCorrection["reason"] | undefined;
  if (selectedIds.length === 0) {
    selectedIds = presetQuestionScopeIds("normal", snapshot.characters);
    requestedRules = questionScopePresetRules("normal");
    preferredPreset = "normal";
    reason = "empty-pool-fallback";
  } else if (selectedIds.length !== incomingIds.length) {
    reason = "invalid-ids-dropped";
  }

  const config = canonicalConfig(
    snapshot,
    selectedIds,
    requestedRules,
    preferredPreset,
  );
  const changed =
    catalogChanged ||
    input.schemaVersion !== QUESTION_SCOPE_SCHEMA_VERSION ||
    input.mode !== config.mode ||
    input.difficulty !== config.difficulty ||
    !sameIds(input.selectedCharacterIds ?? [], config.selectedCharacterIds) ||
    !rulesEqual(normalizeQuestionScopeRules(input.rules), config.rules);

  return {
    config,
    changed,
    reason: reason ?? (catalogChanged ? "catalog-updated" : undefined),
  };
}

export function toggleWorkInQuestionScope(
  config: QuestionScopeConfig,
  snapshot: FullCatalogSnapshot,
  workId: string,
): QuestionScopeConfig {
  const workState = config.workStates.find((state) => state.workId === workId);
  const selected = new Set(config.selectedCharacterIds);
  const shouldSelectAll = workState?.state !== "all";
  for (const character of snapshot.characters) {
    if (
      !character.enabledAsAnswer ||
      character.firstAppearance.workId !== workId
    ) {
      continue;
    }
    if (shouldSelectAll) selected.add(character.id);
    else selected.delete(character.id);
  }
  return canonicalConfig(
    snapshot,
    normalizeSelectedIds([...selected], snapshot.characters),
    config.rules,
    isPreset(config.difficulty) ? config.difficulty : undefined,
  );
}

export function toggleCharacterInQuestionScope(
  config: QuestionScopeConfig,
  snapshot: FullCatalogSnapshot,
  characterId: string,
): QuestionScopeConfig {
  const character = snapshot.characters.find(
    (entry) => entry.id === characterId,
  );
  if (!character?.enabledAsAnswer) return config;
  const selected = new Set(config.selectedCharacterIds);
  if (selected.has(characterId)) selected.delete(characterId);
  else selected.add(characterId);
  return canonicalConfig(
    snapshot,
    normalizeSelectedIds([...selected], snapshot.characters),
    config.rules,
    isPreset(config.difficulty) ? config.difficulty : undefined,
  );
}

export function updateQuestionScopeRules(
  config: QuestionScopeConfig,
  snapshot: FullCatalogSnapshot,
  rules: Partial<QuestionScopeRules>,
): QuestionScopeConfig {
  return canonicalConfig(
    snapshot,
    normalizeSelectedIds(config.selectedCharacterIds, snapshot.characters),
    normalizeQuestionScopeRules(rules),
    isPreset(config.difficulty) ? config.difficulty : undefined,
  );
}

export function applyQuestionScopePreset(
  snapshot: FullCatalogSnapshot,
  preset: QuestionDifficultyPreset,
): QuestionScopeConfig {
  return canonicalConfig(
    snapshot,
    presetQuestionScopeIds(preset, snapshot.characters),
    questionScopePresetRules(preset),
    preset,
  );
}
