import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import charactersJson from "../src/characters.demo.json";
import worksJson from "../src/works.demo.json";
import { charactersSchema, worksSchema } from "../src/schema";
import {
  buildCatalogWorkbook,
  buildWorkbook,
  buildWorksWorkbook,
  flatten,
  mergeCatalogs,
  readCharactersFromWorkbook,
  readWorksFromWorkbook,
} from "../src/convert-excel";

const workbookFromRows = (
  rows: Record<string, unknown>[],
  sheetName = "characters",
) => {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return workbook;
};

describe("excel catalog conversion", () => {
  const characters = charactersSchema.parse(charactersJson);

  it("round-trips the demo catalog byte-for-byte", () => {
    const workbook = buildWorkbook(characters);
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const restored = XLSX.read(buffer, { type: "buffer" });
    expect(readCharactersFromWorkbook(restored)).toEqual(characters);
  });

  it("normalizes boolean columns from varied textual forms", () => {
    const row = flatten(characters[0]);
    row.playable = "yes";
    row.enabledAsAnswer = "1";
    row.enabledAsGuess = "是";
    const restored = readCharactersFromWorkbook(workbookFromRows([row]));
    expect(restored[0].playable).toBe(true);
    expect(restored[0].enabledAsAnswer).toBe(true);
    expect(restored[0].enabledAsGuess).toBe(true);

    const falseRow = flatten(characters[0]);
    falseRow.playable = "no";
    falseRow.enabledAsAnswer = "0";
    falseRow.enabledAsGuess = "否";
    const restoredFalse = readCharactersFromWorkbook(workbookFromRows([falseRow]));
    expect(restoredFalse[0].playable).toBe(false);
    expect(restoredFalse[0].enabledAsAnswer).toBe(false);
    expect(restoredFalse[0].enabledAsGuess).toBe(false);
  });

  it("trims array cells and drops empty segments", () => {
    const row = flatten(characters[0]);
    row.species = " 人类 | 妖怪 || 神灵 ";
    row.abilityTags = " 飞行 | 灵力 ";
    const restored = readCharactersFromWorkbook(workbookFromRows([row]));
    expect(restored[0].species).toEqual(["人类", "妖怪", "神灵"]);
    expect(restored[0].abilityTags).toEqual(["飞行", "灵力"]);
  });

  it("maps blank optional strings to undefined and keeps non-blank ones", () => {
    const row = flatten(characters[0]);
    row["names.zhHant"] = "";
    row["names.romaji"] = "Hakurei Reimu";
    const restored = readCharactersFromWorkbook(workbookFromRows([row]));
    expect(restored[0].names.zhHant).toBeUndefined();
    expect(restored[0].names.romaji).toBe("Hakurei Reimu");
  });

  it("fails clearly when the characters worksheet is missing", () => {
    const emptyBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      emptyBook,
      XLSX.utils.json_to_sheet([]),
      "other",
    );
    expect(() => readCharactersFromWorkbook(emptyBook)).toThrow(/characters/);
  });

  it("flattens every character to one row with a header", () => {
    const workbook = buildWorkbook(characters);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      raw: true,
    });
    expect(rows).toHaveLength(characters.length);
    const reimu = rows.find((row) => row.id === "reimu_hakurei");
    expect(reimu?.["names.zhHans"]).toBe("博丽灵梦");
  });

  it("rejects rows that violate the source schema", () => {
    const workbook = buildWorkbook([characters[0]]);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      raw: true,
      defval: "",
    });
    rows[0]["id"] = "";
    const corrupted = XLSX.utils.json_to_sheet(rows, {
      header: [...Object.keys(rows[0])],
    });
    const badBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(badBook, corrupted, "characters");
    expect(() => readCharactersFromWorkbook(badBook)).toThrow();
  });
});

describe("works excel conversion", () => {
  const works = worksSchema.parse(worksJson);

  it("round-trips the demo works catalog byte-for-byte", () => {
    const workbook = buildWorksWorkbook(works);
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const restored = XLSX.read(buffer, { type: "buffer" });
    expect(readWorksFromWorkbook(restored)).toEqual(works);
  });

  it("keeps numeric cells as numbers", () => {
    const workbook = buildWorksWorkbook([works[0]]);
    const worksheet = workbook.Sheets["works"]!;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      raw: true,
    });
    expect(rows[0].releaseYear).toBe(works[0].releaseYear);
  });

  it("exports work pinyin initials as a multi-value column", () => {
    const workbook = buildWorksWorkbook(works);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets["works"]!,
      { raw: true },
    );
    const eosd = rows.find((row) => row.id === "th06_eosd");
    expect(eosd?.pinyinInitials).toBe("hmx|dfhmx");
  });

  it("maps blank optional string and number cells to undefined", () => {
    const workbook = buildWorksWorkbook(works);
    const worksheet = workbook.Sheets["works"]!;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      raw: true,
      defval: "",
    });
    const th01 = rows.find((row) => row.id === "th01_hrtp")!;
    th01["titleEn"] = "";
    th01["mainlineIndex"] = "";
    th01["era"] = "";
    const restored = readWorksFromWorkbook(
      workbookFromRows(rows, "works"),
    );
    const roundTripped = restored.find((work) => work.id === "th01_hrtp");
    expect(roundTripped?.titleEn).toBeUndefined();
    expect(roundTripped?.mainlineIndex).toBeUndefined();
    expect(roundTripped?.era).toBeUndefined();
  });

  it("rejects a blank required number cell", () => {
    const workbook = buildWorksWorkbook([works[0]]);
    const worksheet = workbook.Sheets["works"]!;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      raw: true,
      defval: "",
    });
    rows[0]["releaseYear"] = "";
    expect(() => readWorksFromWorkbook(workbookFromRows(rows, "works"))).toThrow();
  });

  it("fails clearly when the works worksheet is missing", () => {
    const emptyBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      emptyBook,
      XLSX.utils.json_to_sheet([]),
      "other",
    );
    expect(() => readWorksFromWorkbook(emptyBook)).toThrow(/works/);
  });
});

describe("combined catalog workbook", () => {
  const characters = charactersSchema.parse(charactersJson);
  const works = worksSchema.parse(worksJson);

  it("holds both datasets as separate sheets and round-trips them", () => {
    const workbook = buildCatalogWorkbook(characters, works);
    expect(workbook.SheetNames).toEqual(["characters", "works"]);
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const restored = XLSX.read(buffer, { type: "buffer" });
    expect(readCharactersFromWorkbook(restored)).toEqual(characters);
    expect(readWorksFromWorkbook(restored)).toEqual(works);
  });
});

describe("three-way catalog merge", () => {
  const clone = <T>(value: T): T => structuredClone(value);
  const characters = charactersSchema.parse(charactersJson);
  const upstreamAdded = characters.slice(113); // the 29 characters not in the old xlsx

  it("preserves upstream-only characters untouched", () => {
    const base = characters.slice(0, 113);
    const edited = clone(base); // xlsx rows: same content, no edits
    const { merged, editedIds, warnings } = mergeCatalogs(base, characters, edited);
    expect(merged).toHaveLength(characters.length);
    expect(editedIds).toEqual([]);
    expect(warnings).toEqual([]);
    expect(merged.slice(113)).toEqual(upstreamAdded);
  });

  it("applies only cells that differ between base and xlsx", () => {
    const base = characters.slice(0, 113);
    const edited = clone(base);
    edited[0] = {
      ...edited[0],
      names: { ...edited[0].names, zhHans: "改过的名字" },
      roles: [...edited[0].roles, "新角色标签"],
    };
    const { merged, editedIds, warnings } = mergeCatalogs(base, characters, edited);
    expect(merged).toHaveLength(characters.length);
    expect(editedIds).toEqual([characters[0].id]);
    expect(warnings).toEqual([]);
    const mergedFirst = merged.find((character) => character.id === characters[0].id);
    expect(mergedFirst?.names.zhHans).toBe("改过的名字");
    expect(mergedFirst?.roles).toContain("新角色标签");
    // unedited columns keep the current version's value
    expect(mergedFirst?.names.ja).toBe(characters[0].names.ja);
    expect(merged[1]).toEqual(characters[1]);
    expect(merged.slice(113)).toEqual(upstreamAdded);
  });

  it("does not mutate the current catalog input", () => {
    const base = characters.slice(0, 113);
    const edited = clone(base);
    edited[0] = {
      ...edited[0],
      names: { ...edited[0].names, zhHans: "改过的名字" },
    };
    const snapshot = JSON.stringify(characters);
    mergeCatalogs(base, characters, edited);
    expect(JSON.stringify(characters)).toBe(snapshot);
  });

  it("keeps current when base lacks an id present in both current and xlsx", () => {
    const base = characters.slice(0, 112); // 113th character missing from base
    const edited = clone(characters.slice(0, 113));
    const shared = edited[112];
    edited[112] = {
      ...shared,
      names: { ...shared.names, zhHans: "xlsx 的修改" },
    };
    const { merged, editedIds, warnings } = mergeCatalogs(base, characters, edited);
    const target = characters[112];
    const mergedTarget = merged.find((character) => character.id === target.id);
    expect(mergedTarget).toEqual(target); // xlsx edit NOT applied
    expect(editedIds).not.toContain(target.id);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining(target.id)]),
    );
  });

  it("reports xlsx-only characters and skips them", () => {
    const base = characters.slice(0, 113);
    const edited = clone(base);
    const ghost = clone(characters[0]);
    ghost.id = "ghost_character";
    edited.push(ghost);
    const { merged, warnings } = mergeCatalogs(base, characters, edited);
    expect(merged).toHaveLength(characters.length);
    expect(merged.some((character) => character.id === "ghost_character")).toBe(false);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("ghost_character")]),
    );
  });
});
