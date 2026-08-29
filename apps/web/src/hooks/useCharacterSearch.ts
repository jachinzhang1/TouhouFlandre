"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CharacterSearchResult,
  CharacterSort,
  SortDirection,
} from "@touhouflandre/shared";
import { api } from "../lib/api";
import { useCharacterSearchRouter } from "../features/character-search/CharacterSearchProvider";

export type SinglePlayerCharacterSearchContext = {
  kind: "single-session";
  sessionId: string;
  catalogVersion?: string;
  selectedCharacterIds?: readonly string[];
};

export type MultiplayerCharacterSearchContext = {
  kind: "multiplayer-match";
  roomId: string;
  matchIndex: number;
  catalogVersion?: string;
  selectedCharacterIds?: readonly string[];
};

export type CharacterSearchContext =
  SinglePlayerCharacterSearchContext | MultiplayerCharacterSearchContext;

type CharacterSearchCommonOptions = {
  limit?: number;
  offset?: number;
  delay?: number;
  enabled?: boolean;
  workIds?: string;
  sort?: CharacterSort;
  direction?: SortDirection;
};

export type CharacterSearchOptions = CharacterSearchCommonOptions &
  (
    | {
        context: CharacterSearchContext;
        version?: never;
      }
    | {
        context?: undefined;
        /** Version-only catalog lookup for non-game consumers. */
        version?: string;
      }
  );

export function useCharacterSearch(
  query: string,
  options: CharacterSearchOptions = {},
) {
  const {
    delay = 120,
    direction = "asc",
    enabled = true,
    context,
    limit,
    offset,
    workIds,
    sort = "appearance",
    version,
  } = options;
  const router = useCharacterSearchRouter();
  const sessionId =
    context?.kind === "single-session" ? context.sessionId : undefined;
  const roomId =
    context?.kind === "multiplayer-match" ? context.roomId : undefined;
  const matchIndex =
    context?.kind === "multiplayer-match" ? context.matchIndex : undefined;
  const [results, setResults] = useState<CharacterSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [requestVersion, setRequestVersion] = useState(0);

  const retry = useCallback(() => {
    setRequestVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setResults([]);
      setTotal(0);
      setError("");
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setResults([]);
    setTotal(0);

    const request = {
      q: query,
      sessionId,
      roomId,
      matchIndex,
      catalogVersion:
        context?.catalogVersion ?? (context ? undefined : version),
      workIds,
      limit,
      offset,
      sort,
      direction,
      contextKind: context?.kind ?? "catalog",
      selectedCharacterIds: context?.selectedCharacterIds,
      retry: requestVersion > 0,
    } as const;
    const run = async () => {
      try {
        const payload = router
          ? await router.search(request, controller.signal)
          : await api.searchCharacters(
              {
                q: query,
                sessionId,
                roomId,
                matchIndex,
                catalogVersion: context ? undefined : version,
                workIds,
                limit,
                offset,
                sort,
                direction,
              },
              controller.signal,
            );
        if (controller.signal.aborted) return;
        setResults(payload.results);
        setTotal(payload.total);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setResults([]);
          setTotal(0);
          setError(caught instanceof Error ? caught.message : "搜索失败。");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    const localCapable = router?.prefersLocal(request) ?? false;
    const timeout = window.setTimeout(
      () => void run(),
      localCapable ? 0 : delay,
    );
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [
    delay,
    direction,
    enabled,
    limit,
    offset,
    query,
    requestVersion,
    roomId,
    matchIndex,
    sessionId,
    sort,
    version,
    workIds,
    router,
    context?.catalogVersion,
    context?.selectedCharacterIds,
  ]);

  return { results, total, error, loading, retry };
}

/** Best-effort local index warmup for game surfaces before the input is active. */
export function useCharacterSearchPrefetch(
  context: CharacterSearchContext | undefined,
): void {
  const router = useCharacterSearchRouter();
  const contextKind = context?.kind;
  const sessionId =
    context?.kind === "single-session" ? context.sessionId : undefined;
  const roomId =
    context?.kind === "multiplayer-match" ? context.roomId : undefined;
  const matchIndex =
    context?.kind === "multiplayer-match" ? context.matchIndex : undefined;
  const catalogVersion = context?.catalogVersion;
  const selectedCharacterIds = context?.selectedCharacterIds;
  const request = useMemo(() => {
    if (!context) return undefined;
    return {
      q: "",
      sessionId,
      roomId,
      matchIndex,
      catalogVersion,
      contextKind,
      selectedCharacterIds,
    } as const;
  }, [
    catalogVersion,
    contextKind,
    matchIndex,
    roomId,
    selectedCharacterIds,
    sessionId,
  ]);

  useEffect(() => {
    if (!router || !request?.catalogVersion) return;
    void router.prefetch(request);
  }, [request, router]);
}
