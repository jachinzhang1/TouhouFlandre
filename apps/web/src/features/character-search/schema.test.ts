import { describe, expect, it } from "vitest";
import { SearchIndexValidationError, validateSearchIndex } from "./schema";

const valid = {
  catalogVersion: "catalog-v1",
  indexSchemaVersion: 2,
  entries: [
    {
      id: "reimu",
      name: "灵梦",
      subtitle: "Reimu",
      initials: "灵梦",
      avatarUrl: "",
      appearanceOrder: 1,
      workId: "th06",
      firstAppearance: { workTitle: "东方红魔乡", releaseYear: 2002 },
      species: [],
      locations: [],
      affiliations: [],
      hairColors: [],
      searchTerms: [{ value: "reimu", source: "en" }],
      nameSortKey: "reimu",
    },
  ],
};

describe("search index schema", () => {
  it("validates and rejects structural errors before search", () => {
    expect(validateSearchIndex(valid, "catalog-v1").entries).toHaveLength(1);
    expect(() =>
      validateSearchIndex({ ...valid, indexSchemaVersion: 1 }),
    ).toThrowError(SearchIndexValidationError);
    expect(() =>
      validateSearchIndex({ ...valid, catalogVersion: "other" }, "catalog-v1"),
    ).toThrow(/VERSION_MISMATCH|does not match/);
    expect(() =>
      validateSearchIndex({
        ...valid,
        entries: [valid.entries[0], valid.entries[0]],
      }),
    ).toThrow(/duplicate character id/);
    expect(() =>
      validateSearchIndex({
        ...valid,
        entries: [
          { ...valid.entries[0], searchTerms: [{ value: "", source: "en" }] },
        ],
      }),
    ).toThrow(/invalid search fields/);
    expect(() =>
      validateSearchIndex({
        ...valid,
        entries: [
          {
            ...valid.entries[0],
            searchTerms: [{ value: "reimu", source: "unknown" }],
          },
        ],
      }),
    ).toThrow(/invalid search fields/);
    expect(() =>
      validateSearchIndex({
        ...valid,
        entries: [
          {
            ...valid.entries[0],
            searchTerms: [
              { value: "reimu", source: "en" },
              { value: "reimu", source: "en" },
            ],
          },
        ],
      }),
    ).toThrow(/duplicate terms/);
    expect(
      validateSearchIndex({
        ...valid,
        entries: [
          {
            ...valid.entries[0],
            searchTerms: [
              { value: "reimu", source: "en" },
              { value: "reimu", source: "alias" },
            ],
          },
        ],
      }).entries[0].searchTerms,
    ).toHaveLength(2);
  });
});
