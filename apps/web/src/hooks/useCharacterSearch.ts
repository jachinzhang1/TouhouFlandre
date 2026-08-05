"use client";

import { useEffect, useState } from "react";
import type {
  CharacterSearchResult,
  CharacterSort,
  SortDirection,
} from "@touhoufriberg/shared";
import { api } from "../lib/api";

export function useCharacterSearch(
  query: string,
  options: {
    limit?: number;
    offset?: number;
    delay?: number;
    sort?: CharacterSort;
    direction?: SortDirection;
  } = {},
) {
  const { delay = 120, direction, limit, offset, sort } = options;
  const [results, setResults] = useState<CharacterSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");

    const timeout = window.setTimeout(async () => {
      try {
        const payload = await api.searchCharacters(
          {
            q: query,
            limit,
            offset,
            sort,
            direction,
          },
          controller.signal,
        );
        setResults(payload.results);
        setTotal(payload.total);
      } catch (caught) {
        if (!controller.signal.aborted) {
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
  }, [delay, direction, limit, offset, query, sort]);

  return { results, total, error, loading };
}
