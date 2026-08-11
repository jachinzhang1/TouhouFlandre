"use client";

import {
  defaultQuestionScope,
  normalizeQuestionScope,
  type FullCatalogSnapshot,
  type QuestionScopeConfig,
  type QuestionScopeCorrection,
} from "@touhouflandre/shared";

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

export function saveLocalQuestionScope(config: QuestionScopeConfig): void {
  localStorage.setItem(QUESTION_SCOPE_STORAGE_KEY, JSON.stringify(config));
}

export function loadLocalQuestionScope(
  snapshot: FullCatalogSnapshot,
): QuestionScopeCorrection {
  const correction = normalizeQuestionScope(readStoredQuestionScope(), snapshot);
  if (correction.changed) saveLocalQuestionScope(correction.config);
  return correction;
}

export function localQuestionScopeOrDefault(
  snapshot: FullCatalogSnapshot,
): QuestionScopeConfig {
  return loadLocalQuestionScope(snapshot).config ?? defaultQuestionScope(snapshot);
}

export function catalogFullToSnapshot(value: unknown): FullCatalogSnapshot {
  const catalog = value as FullCatalogSnapshot;
  return {
    version: catalog.version,
    works: catalog.works ?? [],
    characters: catalog.characters ?? [],
  };
}
