import * as fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { z } from "zod";
import * as XLSX from "xlsx";
import { charactersSchema, characterSourceSchema } from "./schema";

type CharacterSource = z.infer<typeof characterSourceSchema>;

/**
 * `|` never appears in any string field of the demo catalog, so it is a safe
 * separator for joining multi-value columns (species, tags, sourceRefs, ...).
 */
const SEPARATOR = "|";

const ARRAY_COLUMNS = [
  "names.aliases",
  "species",
  "abilityTags",
  "affiliations",
  "locations",
  "roles",
  "hairColors",
  "sourceRefs",
] as const;

const BOOLEAN_COLUMNS = [
  "playable",
  "enabledAsAnswer",
  "enabledAsGuess",
] as const;

/** Optional scalar string columns: an empty cell round-trips back to `undefined`. */
const OPTIONAL_STRING_COLUMNS = ["names.zhHant", "names.romaji"] as const;

/** Flat column order — follows `characterSourceSchema` field order for readability. */
const COLUMNS = [
  "id",
  "avatarUrl",
  "names.zhHans",
  "names.zhHant",
  "names.ja",
  "names.en",
  "names.romaji",
  "names.aliases",
  "firstAppearance.workId",
  "species",
  "abilityDisplay",
  "abilityTags",
  "affiliations",
  "locations",
  "roles",
  "hairColors",
  "playable",
  "enabledAsAnswer",
  "enabledAsGuess",
  "difficultyTier",
  "sourceRefs",
] as const;

type Column = (typeof COLUMNS)[number];

const SOURCE_JSON = fileURLToPath(
  new URL("./characters.demo.json", import.meta.url),
);
const DEFAULT_XLSX = fileURLToPath(
  new URL("./characters.demo.xlsx", import.meta.url),
);

function getPath(source: CharacterSource, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (acc, key) => (acc as Record<string, unknown> | undefined)?.[key],
    source,
  );
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split(".");
  let cursor = target;
  for (const key of keys.slice(0, -1)) {
    cursor[key] ??= {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]] = value;
}

function flatten(character: CharacterSource): Record<Column, string> {
  const row = {} as Record<Column, string>;
  for (const column of COLUMNS) {
    const value = getPath(character, column);
    if (Array.isArray(value)) {
      row[column] = value.join(SEPARATOR);
    } else if (typeof value === "boolean") {
      row[column] = value ? "true" : "false";
    } else if (value === undefined) {
      row[column] = "";
    } else {
      row[column] = String(value);
    }
  }
  return row;
}

function parseArrayCell(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseBooleanCell(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  const text = String(value).trim().toLowerCase();
  return text === "true" || text === "1" || text === "yes" || text === "是";
}

function unflatten(row: Record<string, unknown>): CharacterSource {
  const character = {} as Record<string, unknown>;
  for (const column of COLUMNS) {
    const value = row[column];
    if (ARRAY_COLUMNS.includes(column as (typeof ARRAY_COLUMNS)[number])) {
      setPath(character, column, parseArrayCell(value));
    } else if (BOOLEAN_COLUMNS.includes(column as (typeof BOOLEAN_COLUMNS)[number])) {
      setPath(character, column, parseBooleanCell(value));
    } else if (
      OPTIONAL_STRING_COLUMNS.includes(column as (typeof OPTIONAL_STRING_COLUMNS)[number])
    ) {
      const text = typeof value === "string" ? value.trim() : "";
      if (text.length > 0) {
        setPath(character, column, text);
      }
    } else {
      setPath(character, column, String(value ?? "").trim());
    }
  }
  return characterSourceSchema.parse(character) as CharacterSource;
}

export function buildWorkbook(characters: CharacterSource[]): XLSX.WorkBook {
  const rows = characters.map(flatten);
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: [...COLUMNS] });
  worksheet["!cols"] = COLUMNS.map((column) => ({
    wch: Math.max(column.length + 2, 16),
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "characters");
  return workbook;
}

export function readCharactersFromWorkbook(
  workbook: XLSX.WorkBook,
): CharacterSource[] {
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    raw: true,
    defval: "",
  });
  return rows.map(unflatten);
}

function jsonToExcel() {
  const characters = charactersSchema.parse(
    JSON.parse(fs.readFileSync(SOURCE_JSON, "utf8")),
  );
  const buffer = XLSX.write(buildWorkbook(characters), {
    type: "buffer",
    bookType: "xlsx",
  });
  fs.writeFileSync(DEFAULT_XLSX, buffer);
  console.log(`Wrote ${characters.length} characters to ${DEFAULT_XLSX}`);
}

function excelToJson() {
  const workbook = XLSX.read(fs.readFileSync(DEFAULT_XLSX), { type: "buffer" });
  const characters = readCharactersFromWorkbook(workbook);
  charactersSchema.parse(characters);
  fs.writeFileSync(
    SOURCE_JSON,
    `${JSON.stringify(characters, null, 2)}\n`,
    "utf8",
  );
  console.log(
    `Validated and wrote ${characters.length} characters to ${SOURCE_JSON}`,
  );
}

function main() {
  const [command] = process.argv.slice(2);
  switch (command) {
    case "json2excel":
      jsonToExcel();
      break;
    case "excel2json":
      excelToJson();
      break;
    default:
      console.error("Usage: tsx src/convert-excel.ts <json2excel|excel2json>");
      process.exit(1);
  }
}

const isEntry =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  main();
}
