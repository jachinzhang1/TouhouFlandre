import { describe, expect, it } from "vitest";
import {
  normalizeQuestionScope,
  questionScopePresetRules,
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
  ],
};

describe("question scope normalization", () => {
  it("recomputes preset identity from the current catalog", () => {
    const correction = normalizeQuestionScope(
      {
        schemaVersion: QUESTION_SCOPE_SCHEMA_VERSION,
        catalogVersion: "v1",
        mode: "preset",
        difficulty: "normal",
        selectedCharacterIds: ["easy-one", "normal-one"],
        workStates: [],
        rules: { hiddenFields: [] },
      },
      snapshot,
    );

    expect(correction.config.catalogVersion).toBe("v2");
    expect(correction.config.schemaVersion).toBe(QUESTION_SCOPE_SCHEMA_VERSION);
    expect(correction.config.difficulty).toBe("normal");
    expect(correction.config.mode).toBe("preset");
    expect(correction.config.workStates.find((state) => state.workId === "th06")?.state).toBe("all");
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
        rules: { hiddenFields: [] },
      },
      snapshot,
    );

    expect(correction.reason).toBe("invalid-ids-dropped");
    expect(correction.config.selectedCharacterIds).toEqual(["easy-one"]);
    expect(correction.config.difficulty).toBe("easy");
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
    expect(correction.config.selectedCharacterIds).toEqual(["easy-one", "normal-one"]);
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
        selectedCharacterIds: ["easy-one", "normal-one", "hard-one"],
        workStates: [],
        rules: { hiddenFields: ["firstAppearance"], turnSeconds: 12 },
      },
      snapshot,
    );

    expect(correction.config.schemaVersion).toBe(2);
    expect(correction.config.rules.fields.firstAppearance).toBe(false);
    expect(correction.config.rules.fields.releaseYear).toBe("directional");
    expect(correction.config.rules.turnLimit).toEqual({ enabled: true, seconds: 30 });
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
          fields: {
            ...questionScopePresetRules("hard").fields,
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
          fields: {
            ...questionScopePresetRules("hard").fields,
            firstAppearance: false,
            releaseYear: "hidden",
            species: false,
          },
          turnLimit: { enabled: false, seconds: 30 },
        },
        fields,
      ).map((field) => field.key),
    ).toEqual(["abilityTags"]);
  });
});
