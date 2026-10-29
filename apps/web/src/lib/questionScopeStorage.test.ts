import { beforeEach, describe, expect, it } from "vitest";
import {
  QUESTION_SCOPE_STORAGE_KEY,
  readLocalQuestionScopeInput,
} from "./questionScopeStorage";

const validScope = {
  schemaVersion: 3,
  catalogVersion: "v3",
  mode: "custom",
  difficulty: "custom",
  selectedCharacterIds: ["reimu_hakurei"],
  workStates: [
    { workId: "th06_eosd", state: "partial", selectedCount: 1, totalCount: 2 },
  ],
  rules: {
    fieldModes: { firstAppearance: "visible" },
    turnLimit: { enabled: false, seconds: 30 },
    guessLimit: { enabled: true, maxGuesses: 8 },
  },
};

describe("readLocalQuestionScopeInput", () => {
  beforeEach(() => localStorage.clear());

  it("returns a valid stored request without needing a catalog snapshot", () => {
    localStorage.setItem(
      QUESTION_SCOPE_STORAGE_KEY,
      JSON.stringify(validScope),
    );
    expect(readLocalQuestionScopeInput()).toEqual(validScope);
  });

  it.each([
    "not-json",
    JSON.stringify({ ...validScope, selectedCharacterIds: [1] }),
    JSON.stringify({
      ...validScope,
      rules: { turnLimit: { enabled: true, seconds: 5 } },
    }),
    JSON.stringify({
      ...validScope,
      schemaVersion: 2,
      rules: {
        fields: {
          firstAppearance: true,
          releaseYear: "sideways",
          species: true,
          affiliations: true,
          locations: true,
          hairColors: true,
        },
      },
    }),
  ])("does not expose invalid storage input", (stored) => {
    localStorage.setItem(QUESTION_SCOPE_STORAGE_KEY, stored);
    expect(readLocalQuestionScopeInput()).toBeUndefined();
  });
});
