import { describe, expect, it } from "vitest";
import {
  applyQuestionScopePreset,
  effectiveQuestionScopeMaxGuesses,
  normalizeQuestionScope,
  normalizeQuestionScopeRules,
  presetQuestionScopeIds,
  questionScopePresetRules,
  QUESTION_DIFFICULTY_DESCRIPTIONS,
  QUESTION_DIFFICULTY_LABELS,
  QUESTION_DIFFICULTY_PRESETS,
  DAILY_QUESTION_DIFFICULTY_PRESETS,
  QUESTION_SCOPE_SCHEMA_VERSION,
  visibleQuestionFields,
  type Character,
  type FullCatalogSnapshot,
  type Work,
} from "./index";

const work = (id: string, mainlineIndex: number): Work => ({
  id,
  titleZh: id,
  titleJa: id,
  shortName: id.toUpperCase(),
  pinyinInitials: [id],
  type: "game",
  releaseYear: 2002 + mainlineIndex,
  mainlineIndex,
  era: "windows",
});

const character = (
  id: string,
  workId: string,
  appearanceOrder: number,
  difficultyTier: Character["difficultyTier"],
): Character => ({
  id,
  avatarUrl: "",
  appearanceOrder,
  names: { zhHans: id, ja: id, en: id, aliases: [] },
  firstAppearance: {
    workId,
    workTitle: workId,
    workType: "game",
    releaseYear: 2002,
    mainlineIndex: Number(workId.replace("th", "")),
    era: "windows",
  },
  species: [],
  abilityDisplay: "",
  abilityTags: [],
  affiliations: [],
  locations: [],
  roles: [],
  hairColors: [],
  playable: false,
  enabledAsAnswer: true,
  enabledAsGuess: true,
  difficultyTier,
  sourceRefs: [],
});

const snapshot: FullCatalogSnapshot = {
  version: "v2",
  works: [work("th06", 6), work("th07", 7)],
  characters: [
    character("easy-one", "th06", 1, "easy"),
    character("normal-one", "th06", 2, "normal"),
    character("hard-one", "th07", 3, "hard"),
    character("lunatic-one", "th07", 4, "lunatic"),
    character("extra-one", "th07", 5, "extra"),
  ],
};

const snapshotWithoutExtra: FullCatalogSnapshot = {
  ...snapshot,
  version: "v-without-extra",
  characters: snapshot.characters.filter(
    (entry) => entry.difficultyTier !== "extra",
  ),
};

describe("question scope normalization", () => {
  it("allows a one-guess custom limit", () => {
    const rules = normalizeQuestionScopeRules({
      guessLimit: { enabled: true, maxGuesses: 1 },
    });

    expect(rules.guessLimit.maxGuesses).toBe(1);
    expect(effectiveQuestionScopeMaxGuesses(rules)).toBe(1);
  });

  it("uses a 45 second turn limit for the hard preset", () => {
    const correction = normalizeQuestionScope(
      {
        schemaVersion: QUESTION_SCOPE_SCHEMA_VERSION,
        catalogVersion: "v2",
        mode: "preset",
        difficulty: "hard",
        selectedCharacterIds: ["easy-one", "normal-one", "hard-one"],
        workStates: [],
        rules: questionScopePresetRules("hard"),
      },
      snapshot,
    );

    expect(questionScopePresetRules("hard").turnLimit).toEqual({
      enabled: true,
      seconds: 45,
    });
    expect(correction.config.difficulty).toBe("hard");
    expect(correction.config.rules.turnLimit).toEqual({
      enabled: true,
      seconds: 45,
    });
  });

  it("defines extra as the all-tier preset with an eight-guess, 30-second limit", () => {
    expect(QUESTION_DIFFICULTY_PRESETS).toContain("extra");
    expect(QUESTION_DIFFICULTY_LABELS.extra).toBe("Extra");
    expect(QUESTION_DIFFICULTY_DESCRIPTIONS.extra).toBe(
      "包含仅在旧作中登场的角色",
    );
    expect(presetQuestionScopeIds("extra", snapshot.characters)).toEqual([
      "easy-one",
      "normal-one",
      "hard-one",
      "lunatic-one",
      "extra-one",
    ]);
    expect(questionScopePresetRules("extra").fieldModes.firstAppearance).toBe("hidden");
    expect(questionScopePresetRules("extra").guessLimit).toEqual({
      enabled: true,
      maxGuesses: 8,
    });
    expect(questionScopePresetRules("extra").turnLimit).toEqual({
      enabled: true,
      seconds: 30,
    });
  });

  it("builds cumulative preset pools and reserves all tiers for extra", () => {
    expect(presetQuestionScopeIds("easy", snapshot.characters)).toEqual([
      "easy-one",
    ]);
    expect(presetQuestionScopeIds("normal", snapshot.characters)).toEqual([
      "easy-one",
      "normal-one",
    ]);
    expect(presetQuestionScopeIds("hard", snapshot.characters)).toEqual([
      "easy-one",
      "normal-one",
      "hard-one",
    ]);
    expect(presetQuestionScopeIds("lunatic", snapshot.characters)).toEqual([
      "easy-one",
      "normal-one",
      "hard-one",
      "lunatic-one",
    ]);
    expect(presetQuestionScopeIds("extra", snapshot.characters)).toEqual(
      snapshot.characters.map((entry) => entry.id),
    );
  });

  it("preserves an explicitly selected extra preset before extra data exists", () => {
    const applied = applyQuestionScopePreset(snapshotWithoutExtra, "extra");

    expect(applied.difficulty).toBe("extra");
    expect(applied.mode).toBe("preset");
    expect(
      normalizeQuestionScope(applied, snapshotWithoutExtra).config.difficulty,
    ).toBe("extra");

    const expanded = normalizeQuestionScope(applied, snapshot).config;
    expect(expanded.difficulty).toBe("extra");
    expect(expanded.selectedCharacterIds).toEqual(
      snapshot.characters.map((entry) => entry.id),
    );
  });

  it("keeps extra unavailable for daily questions", () => {
    expect(DAILY_QUESTION_DIFFICULTY_PRESETS).toEqual([
      "easy",
      "normal",
      "hard",
      "lunatic",
    ]);
    expect(DAILY_QUESTION_DIFFICULTY_PRESETS).not.toContain("extra");
  });

  it("recomputes preset identity from the current catalog", () => {
    const correction = normalizeQuestionScope(
      {
        schemaVersion: QUESTION_SCOPE_SCHEMA_VERSION,
        catalogVersion: "v1",
        mode: "preset",
        difficulty: "normal",
        selectedCharacterIds: ["easy-one"],
        workStates: [],
        rules: { hiddenFields: [] },
      },
      snapshot,
    );

    expect(correction.config.catalogVersion).toBe("v2");
    expect(correction.config.schemaVersion).toBe(QUESTION_SCOPE_SCHEMA_VERSION);
    expect(correction.config.difficulty).toBe("normal");
    expect(correction.config.mode).toBe("preset");
    expect(
      correction.config.workStates.find((state) => state.workId === "th06")
        ?.state,
    ).toBe("all");
  });

  it("drops invalid character ids and falls back to the matching preset", () => {
    const correction = normalizeQuestionScope(
      {
        schemaVersion: QUESTION_SCOPE_SCHEMA_VERSION,
        catalogVersion: "v2",
        mode: "custom",
        difficulty: "custom",
        selectedCharacterIds: ["easy-one", "missing"],
        workStates: [],
        rules: questionScopePresetRules("easy"),
      },
      snapshot,
    );

    expect(correction.reason).toBe("invalid-ids-dropped");
    expect(correction.config.selectedCharacterIds).toEqual(["easy-one"]);
    expect(correction.config.difficulty).toBe("easy");
    expect(correction.config.mode).toBe("preset");
  });

  it("falls back to normal if the selected pool is empty", () => {
    const correction = normalizeQuestionScope(
      {
        schemaVersion: QUESTION_SCOPE_SCHEMA_VERSION,
        catalogVersion: "v1",
        mode: "preset",
        difficulty: "custom",
        selectedCharacterIds: [],
        workStates: [],
        rules: { hiddenFields: [] },
      },
      snapshot,
    );

    expect(correction.reason).toBe("empty-pool-fallback");
    expect(correction.config.selectedCharacterIds).toEqual([
      "easy-one",
      "normal-one",
    ]);
    expect(correction.config.difficulty).toBe("normal");
  });

  it("classifies non-preset selections as custom", () => {
    const correction = normalizeQuestionScope(
      {
        schemaVersion: QUESTION_SCOPE_SCHEMA_VERSION,
        catalogVersion: "v2",
        mode: "preset",
        difficulty: "hard",
        selectedCharacterIds: ["easy-one", "hard-one"],
        workStates: [],
        rules: { hiddenFields: [] },
      },
      snapshot,
    );

    expect(correction.config.mode).toBe("custom");
    expect(correction.config.difficulty).toBe("custom");
  });

  it("normalizes legacy v1 hidden fields and turn seconds to schema v2", () => {
    const correction = normalizeQuestionScope(
      {
        schemaVersion: 1,
        catalogVersion: "v1",
        mode: "preset",
        difficulty: "lunatic",
        selectedCharacterIds: [
          "easy-one",
          "normal-one",
          "hard-one",
          "lunatic-one",
        ],
        workStates: [],
        rules: { hiddenFields: ["firstAppearance"], turnSeconds: 12 },
      },
      snapshot,
    );

    expect(correction.config.schemaVersion).toBe(3);
    expect(correction.config.rules.fieldModes.firstAppearance).toBe("hidden");
    expect(correction.config.rules.fieldModes.releaseYear).toBe("directional");
    expect(correction.config.rules.turnLimit).toEqual({
      enabled: true,
      seconds: 30,
    });
    expect(correction.config.difficulty).toBe("lunatic");
  });

  it("marks label or turn-limit changes as custom", () => {
    const correction = normalizeQuestionScope(
      {
        schemaVersion: QUESTION_SCOPE_SCHEMA_VERSION,
        catalogVersion: "v2",
        mode: "preset",
        difficulty: "hard",
        selectedCharacterIds: ["easy-one", "normal-one", "hard-one"],
        workStates: [],
        rules: {
          ...questionScopePresetRules("hard"),
          fieldModes: {
            ...questionScopePresetRules("hard").fieldModes,
            releaseYear: "exactOnly",
          },
        },
      },
      snapshot,
    );

    expect(correction.config.mode).toBe("custom");
    expect(correction.config.difficulty).toBe("custom");
  });

  it("filters visible fields with the v2 rules", () => {
    const fields = [
      { key: "firstAppearance", label: "work" },
      { key: "releaseYear", label: "year" },
      { key: "species", label: "species" },
      { key: "abilityTags", label: "ability" },
    ] as const;

    expect(
      visibleQuestionFields(
        {
          fieldModes: {
            ...questionScopePresetRules("hard").fieldModes,
            firstAppearance: "hidden",
            releaseYear: "hidden",
            species: "hidden",
          },
          turnLimit: { enabled: false, seconds: 30 },
        },
        fields,
      ).map((field) => field.key),
    ).toEqual(["abilityTags"]);
  });
});
