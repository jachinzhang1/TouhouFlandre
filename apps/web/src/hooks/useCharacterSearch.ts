import { useEffect, useState } from "react";
import type {
  CharacterSort,
  CharacterSearchResponse,
  CharacterSearchResult,
  SortDirection,
} from "@touhoufriberg/shared";
import { requestJson } from "../api";

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
      const params = new URLSearchParams({ q: query });
      if (limit !== undefined) params.set("limit", String(limit));
      if (offset !== undefined) params.set("offset", String(offset));
      if (sort !== undefined) params.set("sort", sort);
      if (direction !== undefined) params.set("direction", direction);

      try {
        const payload = await requestJson<CharacterSearchResponse>(
          `/api/characters/search?${params.toString()}`,
          { signal: controller.signal },
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
