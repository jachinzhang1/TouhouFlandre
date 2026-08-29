import type {
  CatalogSearchIndex,
  CatalogSearchIndexEntry,
} from "@touhouflandre/shared";

export type SearchIndexErrorCode =
  | "INVALID_INDEX"
  | "UNSUPPORTED_SCHEMA"
  | "VERSION_MISMATCH"
  | "DUPLICATE_ID"
  | "INVALID_ENTRY";

export class SearchIndexValidationError extends Error {
  constructor(
    readonly code: SearchIndexErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SearchIndexValidationError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

function validateEntry(value: unknown, index: number): CatalogSearchIndexEntry {
  if (!isRecord(value)) {
    throw new SearchIndexValidationError("INVALID_ENTRY", `entry ${index} is not an object`);
  }
  const requiredStrings = ["id", "name", "subtitle", "initials", "workId", "nameSortKey"];
  if (requiredStrings.some((key) => typeof value[key] !== "string" || value[key] === "")) {
    throw new SearchIndexValidationError("INVALID_ENTRY", `entry ${index} has missing display fields`);
  }
  if (!Number.isInteger(value.appearanceOrder) || !isStringArray(value.searchTerms) || value.searchTerms.length === 0) {
    throw new SearchIndexValidationError("INVALID_ENTRY", `entry ${index} has invalid search fields`);
  }
  if (new Set(value.searchTerms).size !== value.searchTerms.length || value.searchTerms.some((term) => term === "")) {
    throw new SearchIndexValidationError("INVALID_ENTRY", `entry ${index} has duplicate or empty terms`);
  }
  if (!isRecord(value.firstAppearance) || typeof value.firstAppearance.workTitle !== "string" ||
      !Number.isFinite(value.firstAppearance.releaseYear) || !isStringArray(value.species) ||
      !isStringArray(value.locations) || !isStringArray(value.affiliations) || !isStringArray(value.hairColors)) {
    throw new SearchIndexValidationError("INVALID_ENTRY", `entry ${index} has invalid display data`);
  }
  return value as unknown as CatalogSearchIndexEntry;
}

export function validateSearchIndex(
  value: unknown,
  expectedCatalogVersion?: string,
  expectedSchemaVersion = 1,
): CatalogSearchIndex {
  if (!isRecord(value)) {
    throw new SearchIndexValidationError("INVALID_INDEX", "search index is not an object");
  }
  if (value.indexSchemaVersion !== expectedSchemaVersion) {
    throw new SearchIndexValidationError("UNSUPPORTED_SCHEMA", "unsupported search index schema");
  }
  if (typeof value.catalogVersion !== "string" || value.catalogVersion === "") {
    throw new SearchIndexValidationError("INVALID_INDEX", "catalog version is missing");
  }
  if (expectedCatalogVersion !== undefined && value.catalogVersion !== expectedCatalogVersion) {
    throw new SearchIndexValidationError("VERSION_MISMATCH", "catalog version does not match request");
  }
  if (!Array.isArray(value.entries)) {
    throw new SearchIndexValidationError("INVALID_INDEX", "entries are missing");
  }
  const entries = value.entries.map(validateEntry);
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) {
      throw new SearchIndexValidationError("DUPLICATE_ID", `duplicate character id: ${entry.id}`);
    }
    ids.add(entry.id);
  }
  return { catalogVersion: value.catalogVersion, indexSchemaVersion: value.indexSchemaVersion, entries } as CatalogSearchIndex;
}
