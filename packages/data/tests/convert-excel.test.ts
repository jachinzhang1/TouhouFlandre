import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import charactersJson from "../src/characters.demo.json";
import { charactersSchema } from "../src/schema";
import { buildWorkbook, readCharactersFromWorkbook } from "../src/convert-excel";

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
