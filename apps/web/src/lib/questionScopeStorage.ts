"use client";

import {
  defaultQuestionScope,
  normalizeQuestionScope,
  type FullCatalogSnapshot,
  type QuestionScopeConfig,
  type QuestionScopeCorrection,
} from "@touhouflandre/shared";
import type { components } from "../generated/api";

export const QUESTION_SCOPE_STORAGE_KEY = "touhouflandre:question-scope";

function readStoredQuestionScope(): Partial<QuestionScopeConfig> | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(QUESTION_SCOPE_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Partial<QuestionScopeConfig>;
  } catch {
    return null;
  }
}

type QuestionScopeConfigInput =
  components["schemas"]["QuestionScopeConfigInput"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isIntegerInRange = (value: unknown, minimum: number, maximum: number) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= minimum &&
  value <= maximum;

function isQuestionScopeFieldRulesInput(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.firstAppearance === "boolean" &&
    ["hidden", "exactOnly", "directional"].includes(
      value.releaseYear as string,
    ) &&
    typeof value.species === "boolean" &&
    typeof value.affiliations === "boolean" &&
    typeof value.locations === "boolean" &&
    typeof value.hairColors === "boolean"
  );
}

function isQuestionScopeRulesInput(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (
    value.fieldModes !== undefined &&
    (!isRecord(value.fieldModes) ||
      !Object.values(value.fieldModes).every(
        (mode) => typeof mode === "string",
      ))
  ) {
    return false;
  }
  if (
    value.hiddenFields !== undefined &&
    (!Array.isArray(value.hiddenFields) ||
      !value.hiddenFields.every((field) => typeof field === "string"))
  ) {
    return false;
  }
  if (
    value.turnSeconds !== undefined &&
    !isIntegerInRange(value.turnSeconds, 1, Number.MAX_SAFE_INTEGER)
  ) {
    return false;
  }
  if (value.turnLimit !== undefined) {
    if (
      !isRecord(value.turnLimit) ||
      typeof value.turnLimit.enabled !== "boolean" ||
      !isIntegerInRange(value.turnLimit.seconds, 30, 120)
    ) {
      return false;
    }
  }
  if (value.guessLimit !== undefined) {
    if (
      !isRecord(value.guessLimit) ||
      typeof value.guessLimit.enabled !== "boolean" ||
      !isIntegerInRange(value.guessLimit.maxGuesses, 1, 20)
    ) {
      return false;
    }
  }
  if (
    value.fields !== undefined &&
    !isQuestionScopeFieldRulesInput(value.fields)
  ) {
    return false;
  }
  return true;
}

function isQuestionScopeConfigInput(
  value: unknown,
): value is QuestionScopeConfigInput {
  if (!isRecord(value)) return false;
  if (![1, 2, 3].includes(value.schemaVersion as number)) return false;
  if (typeof value.catalogVersion !== "string") return false;
  if (value.mode !== "preset" && value.mode !== "custom") return false;
  if (
    !["easy", "normal", "hard", "lunatic", "extra", "custom"].includes(
      value.difficulty as string,
    )
  ) {
    return false;
  }
  if (
    !Array.isArray(value.selectedCharacterIds) ||
    !value.selectedCharacterIds.every((id) => typeof id === "string")
  ) {
    return false;
  }
  if (
    !Array.isArray(value.workStates) ||
    !value.workStates.every(
      (state) =>
        isRecord(state) &&
        typeof state.workId === "string" &&
        ["all", "partial", "none"].includes(state.state as string) &&
        isIntegerInRange(state.selectedCount, 0, Number.MAX_SAFE_INTEGER) &&
        isIntegerInRange(state.totalCount, 0, Number.MAX_SAFE_INTEGER),
    )
  ) {
    return false;
  }
  return isQuestionScopeRulesInput(value.rules);
}

export function readLocalQuestionScopeInput():
  QuestionScopeConfigInput | undefined {
  if (typeof window === "undefined") return undefined;
  const raw = localStorage.getItem(QUESTION_SCOPE_STORAGE_KEY);
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isQuestionScopeConfigInput(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function saveLocalQuestionScope(config: QuestionScopeConfig): void {
  localStorage.setItem(QUESTION_SCOPE_STORAGE_KEY, JSON.stringify(config));
}

export function loadLocalQuestionScope(
  snapshot: FullCatalogSnapshot,
): QuestionScopeCorrection {
  const correction = normalizeQuestionScope(
    readStoredQuestionScope(),
    snapshot,
  );
  if (correction.changed) saveLocalQuestionScope(correction.config);
  return correction;
}

export function localQuestionScopeOrDefault(
  snapshot: FullCatalogSnapshot,
): QuestionScopeConfig {
  return (
    loadLocalQuestionScope(snapshot).config ?? defaultQuestionScope(snapshot)
  );
}

export function catalogFullToSnapshot(value: unknown): FullCatalogSnapshot {
  const catalog = value as FullCatalogSnapshot;
  return {
    version: catalog.version,
    works: catalog.works ?? [],
    characters: catalog.characters ?? [],
    fieldDefinitions: catalog.fieldDefinitions ?? [],
  };
}
