"use client";

import { useEffect, useMemo, useState } from "react";
import type { CharacterSort, SortDirection, Work } from "@touhouflandre/shared";
import { useCatalogSummary } from "../../hooks/useCatalogSummary";
import type { CharacterView, WorkFilterMode } from "./types";

const initialParams =
  typeof window === "undefined"
    ? new URLSearchParams()
    : new URLSearchParams(window.location.search);
const initialView: CharacterView =
  initialParams.get("view") === "list" ? "list" : "grid";
const initialSort: CharacterSort =
  initialParams.get("sort") === "name" ? "name" : "appearance";
const initialDirection: SortDirection =
  initialParams.get("direction") === "desc" ? "desc" : "asc";

const compareWorks = (left: Work, right: Work) =>
  left.releaseYear - right.releaseYear ||
  (left.mainlineIndex ?? Number.MAX_SAFE_INTEGER) -
    (right.mainlineIndex ?? Number.MAX_SAFE_INTEGER) ||
  left.shortName.localeCompare(right.shortName) ||
  left.id.localeCompare(right.id);

export function useSearchPageState() {
  const catalog = useCatalogSummary();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<CharacterView>(initialView);
  const [sort, setSort] = useState<CharacterSort>(initialSort);
  const [direction, setDirection] = useState<SortDirection>(initialDirection);
  const [workFilterMode, setWorkFilterMode] =
    useState<WorkFilterMode>("whitelist");
  const [selectedWorkIds, setSelectedWorkIds] = useState<string[]>([]);
  const works = useMemo(
    () => [...(catalog?.works ?? [])].sort(compareWorks),
    [catalog?.works],
  );
  const workIds = useMemo(() => works.map((work) => work.id), [works]);
  const selectedWorkIdsParam = useMemo(
    () => resolveWorkIdsParam(workIds, selectedWorkIds, workFilterMode),
    [selectedWorkIds, workFilterMode, workIds],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("view", view);
    params.set("sort", sort);
    params.set("direction", direction);
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}?${params.toString()}`,
    );
  }, [direction, sort, view]);

  return {
    direction,
    query,
    selectedWorkIds,
    selectedWorkIdsParam,
    setDirection,
    setQuery,
    setSelectedWorkIds,
    setSort,
    setView,
    setWorkFilterMode,
    sort,
    view,
    workFilterMode,
    works,
  };
}

export function resolveWorkIdsParam(
  workIds: readonly string[],
  selectedWorkIds: readonly string[],
  mode: WorkFilterMode,
): string | undefined {
  if (selectedWorkIds.length === 0) return undefined;
  if (mode === "whitelist") return selectedWorkIds.join(",");
  const excluded = new Set(selectedWorkIds);
  return workIds.filter((workId) => !excluded.has(workId)).join(",");
}
