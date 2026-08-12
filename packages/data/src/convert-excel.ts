import * as fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { z } from "zod";
import * as XLSX from "xlsx";
import {
  charactersSchema,
  characterSourceSchema,
  worksSchema,
  workSchema,
} from "./schema";

type CharacterSource = z.infer<typeof characterSourceSchema>;
type Work = z.infer<typeof workSchema>;

/**
 * `|` never appears in any string field of the demo catalog, so it is a safe
 * separator for joining multi-value columns (species, tags, sourceRefs, ...).
 */
const SEPARATOR = "|";

/**
 * How a flat Excel cell maps to a (possibly nested) JSON field:
 * - `string` — required scalar string; an empty cell fails schema validation.
 * - `string?` — optional scalar string; an empty cell round-trips to `undefined`.
 * - `string[]` — multi-value column joined/split with {@link SEPARATOR}.
 * - `boolean` — normalized from `true/false/1/0/yes/no/是/否`.
 * - `number` — required integer; an empty or non-numeric cell fails validation.
 * - `number?` — optional integer; an empty cell round-trips to `undefined`.
 */
type CellKind = "string" | "string?" | "string[]" | "boolean" | "number" | "number?";

interface ColumnDef {
  /** Dotted path into the source record, e.g. `names.zhHans`. */
  path: string;
  kind: CellKind;
}

/** One catalog file plus its flat worksheet representation. */
interface DatasetDef {
  name: string;
  sourceJson: string;
  sheetName: string;
  /** Whole-file collection schema (array of records). */
  schema: z.ZodType;
  /** Single-record schema, applied to each parsed Excel row. */
  itemSchema: z.ZodType;
  columns: readonly ColumnDef[];
}

/**
 * Single workbook holding every dataset as its own worksheet — characters and
 * works share one xlsx so a contributor edits the whole catalog in one file.
 * Generated artifact, never committed (see the root .gitignore).
 */
const CATALOG_XLSX = fileURLToPath(
  new URL("./catalog.demo.xlsx", import.meta.url),
);

/** Flat column order — follows the source schema field order for readability. */
const CHARACTER_COLUMNS = [
  { path: "id", kind: "string" },
  { path: "avatarUrl", kind: "string" },
  { path: "names.zhHans", kind: "string" },
  { path: "names.zhHant", kind: "string?" },
  { path: "names.ja", kind: "string" },
  { path: "names.en", kind: "string" },
  { path: "names.romaji", kind: "string?" },
  { path: "names.aliases", kind: "string[]" },
  { path: "firstAppearance.workId", kind: "string" },
  { path: "species", kind: "string[]" },
  { path: "abilityDisplay", kind: "string" },
  { path: "abilityTags", kind: "string[]" },
  { path: "affiliations", kind: "string[]" },
  { path: "locations", kind: "string[]" },
  { path: "roles", kind: "string[]" },
  { path: "hairColors", kind: "string[]" },
  { path: "playable", kind: "boolean" },
  { path: "enabledAsAnswer", kind: "boolean" },
  { path: "enabledAsGuess", kind: "boolean" },
  { path: "difficultyTier", kind: "string" },
  { path: "sourceRefs", kind: "string[]" },
] as const satisfies readonly ColumnDef[];

type Column = (typeof CHARACTER_COLUMNS)[number]["path"];

const WORK_COLUMNS = [
  { path: "id", kind: "string" },
  { path: "titleZh", kind: "string" },
  { path: "titleJa", kind: "string" },
  { path: "titleEn", kind: "string?" },
  { path: "shortName", kind: "string" },
  { path: "pinyinInitials", kind: "string[]" },
  { path: "type", kind: "string" },
  { path: "releaseYear", kind: "number" },
  { path: "mainlineIndex", kind: "number?" },
  { path: "era", kind: "string?" },
] as const satisfies readonly ColumnDef[];

const CHARACTER_DATASET: DatasetDef = {
  name: "characters",
  sourceJson: fileURLToPath(
    new URL("./characters.demo.json", import.meta.url),
  ),
  sheetName: "characters",
  schema: charactersSchema,
  itemSchema: characterSourceSchema,
  columns: CHARACTER_COLUMNS,
};

const WORK_DATASET: DatasetDef = {
  name: "works",
  sourceJson: fileURLToPath(new URL("./works.demo.json", import.meta.url)),
  sheetName: "works",
  schema: worksSchema,
  itemSchema: workSchema,
  columns: WORK_COLUMNS,
};

/** Worksheet order inside the shared workbook. */
const DATASETS = [CHARACTER_DATASET, WORK_DATASET] as const;

type IdRecord = { id: string };

function getPath(source: unknown, path: string): unknown {
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

function flattenRecord(
  record: Record<string, unknown>,
  columns: readonly ColumnDef[],
): Record<string, string | number> {
  const row: Record<string, string | number> = {};
  for (const column of columns) {
    const value = getPath(record, column.path);
    if (column.kind === "string[]") {
      row[column.path] = Array.isArray(value) ? value.join(SEPARATOR) : "";
    } else if (column.kind === "boolean") {
      row[column.path] = value ? "true" : "false";
    } else if (value === undefined) {
      row[column.path] = "";
    } else if (column.kind === "number" || column.kind === "number?") {
      // schema-validated source guarantees a numeric value — keep it numeric
      // in the cell so Excel treats the column as numbers.
      row[column.path] = Number(value);
    } else {
      row[column.path] = String(value);
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

function unflattenRecord(
  row: Record<string, unknown>,
  columns: readonly ColumnDef[],
): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const column of columns) {
    const value = row[column.path];
    switch (column.kind) {
      case "string[]":
        setPath(record, column.path, parseArrayCell(value));
        break;
      case "boolean":
        setPath(record, column.path, parseBooleanCell(value));
        break;
      case "string?": {
        const text = typeof value === "string" ? value.trim() : "";
        if (text.length > 0) {
          setPath(record, column.path, text);
        }
        break;
      }
      case "number": {
        if (typeof value === "number") {
          setPath(record, column.path, value);
          break;
        }
        const text = typeof value === "string" ? value.trim() : "";
        if (text.length === 0) {
          // leave unset — the schema rejects the missing required field
          break;
        }
        setPath(record, column.path, Number(text));
        break;
      }
      case "number?": {
        if (typeof value === "number") {
          setPath(record, column.path, value);
          break;
        }
        const text = typeof value === "string" ? value.trim() : "";
        if (text.length > 0) {
          setPath(record, column.path, Number(text));
        }
        break;
      }
      default: {
        setPath(record, column.path, String(value ?? "").trim());
        break;
      }
    }
  }
  return record;
}

function buildWorksheetFor(records: unknown[], dataset: DatasetDef): XLSX.WorkSheet {
  const header = dataset.columns.map((column) => column.path);
  const rows = records.map((record) =>
    flattenRecord(record as Record<string, unknown>, dataset.columns),
  );
  const worksheet = XLSX.utils.json_to_sheet(rows, { header });
  worksheet["!cols"] = header.map((column) => ({
    wch: Math.max(column.length + 2, 16),
  }));
  return worksheet;
}

function buildWorkbookForSheets(
  sheets: readonly (readonly [unknown[], DatasetDef])[],
): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  for (const [records, dataset] of sheets) {
    XLSX.utils.book_append_sheet(
      workbook,
      buildWorksheetFor(records, dataset),
      dataset.sheetName,
    );
  }
  return workbook;
}

function readDatasetFromWorkbook(workbook: XLSX.WorkBook, dataset: DatasetDef): unknown[] {
  const worksheet = workbook.Sheets[dataset.sheetName];
  if (!worksheet) {
    throw new Error(
      `Expected a worksheet named "${dataset.sheetName}" in the workbook.`,
    );
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    raw: true,
    defval: "",
  });
  return rows.map((row) =>
    dataset.itemSchema.parse(unflattenRecord(row, dataset.columns)),
  );
}

/**
 * Three-way merge for the common workflow: the xlsx was exported from an older
 * catalog (`base`), the working JSON has since moved on (`current`), and the
 * xlsx holds manual edits to pre-existing records only.
 *
 * - Records in `current` but absent from the xlsx (newly added upstream) are
 *   preserved untouched.
 * - For records present in both, only the cells that differ between `base`
 *   and the xlsx are applied onto `current` — stale columns never clobber
 *   upstream changes to the same record.
 * - Records in the xlsx but missing from `current` are reported as warnings
 *   and skipped (current version wins on existence).
 */
function mergeFor(
  base: IdRecord[],
  current: IdRecord[],
  edited: IdRecord[],
  columns: readonly ColumnDef[],
): { merged: IdRecord[]; editedIds: string[]; warnings: string[] } {
  const baseById = new Map(base.map((record) => [record.id, record]));
  const editedById = new Map(edited.map((record) => [record.id, record]));
  const editedIds: string[] = [];
  const warnings: string[] = [];

  const merged = current.map((record) => {
    const edit = editedById.get(record.id);
    if (!edit) {
      return record; // upstream-only record — keep as-is
    }
    const baseRecord = baseById.get(record.id);
    if (!baseRecord) {
      warnings.push(
        `${record.id} is in both the xlsx and current JSON but not in base; kept as-is.`,
      );
      return record;
    }
    // Apply edits to a clone so the `current` input is never mutated.
    let mergedRecord: IdRecord | undefined;
    for (const column of columns) {
      if (
        JSON.stringify(getPath(baseRecord, column.path)) !==
        JSON.stringify(getPath(edit, column.path))
      ) {
        mergedRecord ??= structuredClone(record);
        setPath(mergedRecord as Record<string, unknown>, column.path, getPath(edit, column.path));
      }
    }
    if (mergedRecord) {
      editedIds.push(record.id);
    }
    return mergedRecord ?? record;
  });

  const currentIds = new Set(current.map((record) => record.id));
  for (const edit of edited) {
    if (!currentIds.has(edit.id) && !baseById.has(edit.id)) {
      warnings.push(
        `${edit.id} is in the xlsx but missing from current JSON; skipped (deleted upstream?).`,
      );
    }
  }
  return { merged, editedIds, warnings };
}

export function flatten(character: CharacterSource): Record<Column, string> {
  return flattenRecord(character, CHARACTER_COLUMNS) as Record<Column, string>;
}

export function buildWorkbook(characters: CharacterSource[]): XLSX.WorkBook {
  return buildWorkbookForSheets([[characters, CHARACTER_DATASET]]);
}

export function readCharactersFromWorkbook(
  workbook: XLSX.WorkBook,
): CharacterSource[] {
  return readDatasetFromWorkbook(workbook, CHARACTER_DATASET) as CharacterSource[];
}

export function mergeCatalogs(
  base: CharacterSource[],
  current: CharacterSource[],
  edited: CharacterSource[],
): { merged: CharacterSource[]; editedIds: string[]; warnings: string[] } {
  return mergeFor(base, current, edited, CHARACTER_COLUMNS) as {
    merged: CharacterSource[];
    editedIds: string[];
    warnings: string[];
  };
}

export function buildWorksWorkbook(works: Work[]): XLSX.WorkBook {
  return buildWorkbookForSheets([[works, WORK_DATASET]]);
}

export function readWorksFromWorkbook(workbook: XLSX.WorkBook): Work[] {
  return readDatasetFromWorkbook(workbook, WORK_DATASET) as Work[];
}

export function buildCatalogWorkbook(
  characters: CharacterSource[],
  works: Work[],
): XLSX.WorkBook {
  return buildWorkbookForSheets([
    [characters, CHARACTER_DATASET],
    [works, WORK_DATASET],
  ]);
}

function parseJsonRecords(dataset: DatasetDef, filePath: string): unknown[] {
  return dataset.schema.parse(
    JSON.parse(fs.readFileSync(filePath, "utf8")),
  ) as unknown[];
}

function jsonToExcel() {
  const sheets = DATASETS.map((dataset) => [
    parseJsonRecords(dataset, dataset.sourceJson),
    dataset,
  ] as const);
  const workbook = buildWorkbookForSheets(sheets);
  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  });
  fs.writeFileSync(CATALOG_XLSX, buffer);
  const summary = sheets
    .map(([records, dataset]) => `${records.length} ${dataset.name}`)
    .join(" and ");
  console.log(`Wrote ${summary} to ${CATALOG_XLSX}`);
}

function excelToJson() {
  const workbook = XLSX.read(fs.readFileSync(CATALOG_XLSX), {
    type: "buffer",
  });
  for (const dataset of DATASETS) {
    const records = readDatasetFromWorkbook(workbook, dataset);
    fs.writeFileSync(
      dataset.sourceJson,
      `${JSON.stringify(records, null, 2)}\n`,
      "utf8",
    );
    console.log(
      `Validated and wrote ${records.length} ${dataset.name} to ${dataset.sourceJson}`,
    );
  }
}

function mergeJson(dataset: DatasetDef, basePath: string) {
  const base = parseJsonRecords(dataset, basePath) as IdRecord[];
  const current = parseJsonRecords(dataset, dataset.sourceJson) as IdRecord[];
  const workbook = XLSX.read(fs.readFileSync(CATALOG_XLSX), {
    type: "buffer",
  });
  const edited = readDatasetFromWorkbook(workbook, dataset) as IdRecord[];
  const { merged, editedIds, warnings } = mergeFor(
    base,
    current,
    edited,
    dataset.columns,
  );
  for (const warning of warnings) {
    console.warn(`WARN: ${warning}`);
  }
  dataset.schema.parse(merged);
  fs.writeFileSync(
    dataset.sourceJson,
    `${JSON.stringify(merged, null, 2)}\n`,
    "utf8",
  );
  const editedIdSet = new Set(edited.map((record) => record.id));
  const upstreamNew = current.filter(
    (record) => !editedIdSet.has(record.id),
  ).length;
  console.log(
    `Merged ${editedIds.length} edited ${dataset.name} (${upstreamNew} upstream-only preserved) into ${merged.length} total.`,
  );
}

function main() {
  const args = process.argv.slice(2);
  const datasetName =
    args[0] === "characters" || args[0] === "works" ? args[0] : undefined;
  const rest = datasetName === undefined ? args : args.slice(1);
  const [command] = rest;
  switch (command) {
    case "json2excel":
      // The shared workbook always carries every dataset — the optional
      // dataset prefix only disambiguates `merge`, so it is ignored here.
      jsonToExcel();
      break;
    case "excel2json":
      excelToJson();
      break;
    case "merge": {
      const dataset = DATASETS.find(
        (candidate) => candidate.name === (datasetName ?? "characters"),
      )!;
      const basePath = process.argv[datasetName === undefined ? 3 : 4];
      if (!basePath) {
        console.error(
          `Usage: tsx src/convert-excel.ts ${datasetName ?? "characters"} merge <base.json>`,
        );
        process.exit(1);
      }
      mergeJson(dataset, basePath);
      break;
    }
    default:
      console.error(
        "Usage: tsx src/convert-excel.ts [characters|works] <json2excel|excel2json|merge <base.json>>",
      );
      process.exit(1);
  }
}

const isEntry =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  main();
}
