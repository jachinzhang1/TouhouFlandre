"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  CharacterSearchResult,
  CharacterSort,
  SortDirection,
} from "@touhouflandre/shared";
import { api } from "../lib/api";

export function useCharacterSearch(
  query: string,
  options: {
    limit?: number;
    offset?: number;
    delay?: number;
    enabled?: boolean;
    sessionId?: string;
    workIds?: string;
    sort?: CharacterSort;
    direction?: SortDirection;
    /** Version-bound multiplayer catalog. Ignored when sessionId is present. */
    version?: string;
  } = {},
) {
  const {
    delay = 120,
    direction = "asc",
    enabled = true,
    limit,
    offset,
    sessionId,
    workIds,
    sort = "appearance",
    version,
  } = options;
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
            catalogVersion: sessionId ? undefined : version,
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
    sessionId,
    sort,
    version,
    workIds,
  ]);

  return { results, total, error, loading, retry };
}
