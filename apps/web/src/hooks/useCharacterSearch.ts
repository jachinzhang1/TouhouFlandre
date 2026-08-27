"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  CharacterSearchResult,
  CharacterSort,
  SortDirection,
} from "@touhouflandre/shared";
import { api } from "../lib/api";

export type SinglePlayerCharacterSearchContext = {
  kind: "single-session";
  sessionId: string;
};

export type MultiplayerCharacterSearchContext = {
  kind: "multiplayer-match";
  roomId: string;
  matchIndex: number;
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

    const timeout = window.setTimeout(async () => {
      try {
        const payload = await api.searchCharacters(
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
    }, delay);
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
  ]);

  return { results, total, error, loading, retry };
}
