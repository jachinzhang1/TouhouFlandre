import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import charactersJson from "../src/characters.demo.json";
import { charactersSchema } from "../src/schema";
import {
  buildWorkbook,
  mergeCatalogs,
  readCharactersFromWorkbook,
} from "../src/convert-excel";

describe("excel catalog conversion", () => {
  const characters = charactersSchema.parse(charactersJson);

  it("round-trips the demo catalog byte-for-byte", () => {
    const workbook = buildWorkbook(characters);
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const restored = XLSX.read(buffer, { type: "buffer" });
    expect(readCharactersFromWorkbook(restored)).toEqual(characters);
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
