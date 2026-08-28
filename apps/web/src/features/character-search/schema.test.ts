import { describe, expect, it } from "vitest";
import { SearchIndexValidationError, validateSearchIndex } from "./schema";

const valid = {
  catalogVersion: "catalog-v1", indexSchemaVersion: 1,
  entries: [{ id: "reimu", name: "灵梦", subtitle: "Reimu", initials: "灵梦", avatarUrl: "", appearanceOrder: 1, workId: "th06", firstAppearance: { workTitle: "东方红魔乡", releaseYear: 2002 }, species: [], locations: [], affiliations: [], hairColors: [], searchTerms: ["reimu"], nameSortKey: "reimu" }],
};

describe("search index schema", () => {
  it("validates and rejects structural errors before search", () => {
    expect(validateSearchIndex(valid, "catalog-v1").entries).toHaveLength(1);
    expect(() => validateSearchIndex({ ...valid, indexSchemaVersion: 2 })).toThrowError(SearchIndexValidationError);
    expect(() => validateSearchIndex({ ...valid, catalogVersion: "other" }, "catalog-v1")).toThrow(/VERSION_MISMATCH|does not match/);
    expect(() => validateSearchIndex({ ...valid, entries: [valid.entries[0], valid.entries[0]] })).toThrow(/duplicate character id/);
    expect(() => validateSearchIndex({ ...valid, entries: [{ ...valid.entries[0], searchTerms: ["", "x"] }] })).toThrow(/duplicate or empty terms/);
  });
});
