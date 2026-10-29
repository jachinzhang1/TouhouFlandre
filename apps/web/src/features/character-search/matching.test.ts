import { describe, expect, it } from "vitest";
import { SEARCH_TERM_SOURCES } from "@touhouflandre/shared";
import { searchTermDomain } from "./matching";

describe("search term domains", () => {
  it("classifies every supported source", () => {
    expect(
      Object.fromEntries(
        SEARCH_TERM_SOURCES.map((source) => [source, searchTermDomain(source)]),
      ),
    ).toEqual({
      zhHans: "character",
      zhHant: "character",
      ja: "character",
      en: "character",
      romaji: "character",
      alias: "character",
      workTitle: "work",
      workId: "work",
      workPinyinInitials: "work",
      mainlineIndex: "work",
    });
  });
});
