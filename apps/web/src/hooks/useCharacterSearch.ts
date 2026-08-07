"use client";

// 本地角色搜索：浏览器一次性拉取完整可猜角色表（经 Next 缓存路由），
// 过滤/排序/分页全部在前端执行（08 §10.x；匹配复用 seed 的 search_text 与
// normalizeSearchText，与服务器 ILIKE 语义一致；名称排序复用 nameSortKey）。
import { useEffect, useState } from "react";
import type {
  CharacterSearchResult,
  CharacterSort,
  SortDirection,
} from "@touhouflandre/shared";
import { normalizeSearchText } from "@touhouflandre/shared";
import type { components } from "../generated/api";

type CatalogCharacters = components["schemas"]["CatalogCharacters"];
type TableEntry = { version: string; characters: CharacterSearchResult[] };

// 浏览器侧全表缓存：按调用方期望版本键（无版本 → "__current__"）。
// 表更新（seed 后 currentVersion 变化）时新版本键自然触发重拉；旧版本键保留
// （进行中局绑定旧版本，其建议集仍以旧表为准，与服务器逐版本校验一致）。
const tableCache = new Map<string, TableEntry>();
const inflight = new Map<string, Promise<TableEntry>>();

async function loadTable(version?: string): Promise<TableEntry> {
  const key = version ?? "__current__";
  const hit = tableCache.get(key);
  if (hit) return hit;
  let pending = inflight.get(key);
  if (!pending) {
    pending = fetch("/api/catalog/characters")
      .then((response) => {
        if (!response.ok) throw new Error("角色表加载失败。");
        return response.json() as Promise<CatalogCharacters>;
      })
      .then((data) => {
        const entry = { version: data.version, characters: data.characters };
        tableCache.set(key, entry);
        return entry;
      })
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, pending);
  }
  return pending;
}

/** 本地过滤 + 排序（方向）→ 分页切片；空查询返回全部（与服务器搜索一致）。 */
export function searchLocal(
  entry: TableEntry,
  query: string,
  sort: CharacterSort,
  direction: SortDirection,
  limit: number | undefined,
  offset: number | undefined,
): { results: CharacterSearchResult[]; total: number } {
  const normalized = normalizeSearchText(query);
  const matched =
    normalized === ""
      ? entry.characters
      : entry.characters.filter((c) => c.searchText.includes(normalized));
  const sorted = [...matched].sort((a, b) => {
    const cmp =
      sort === "name"
        ? a.nameSortKey.localeCompare(b.nameSortKey)
        : a.appearanceOrder - b.appearanceOrder;
    return direction === "desc" ? -cmp : cmp;
  });
  const start = offset ?? 0;
  const end = limit === undefined ? sorted.length : start + limit;
  return { results: sorted.slice(start, end), total: sorted.length };
}

export function useCharacterSearch(
  query: string,
  options: {
    limit?: number;
    offset?: number;
    delay?: number;
    sort?: CharacterSort;
    direction?: SortDirection;
    /** 期望题库版本（局/会话绑定版本）；变化时按新键重拉，处理 seed 后表更新。 */
    version?: string;
  } = {},
) {
  const { delay = 120, direction = "asc", limit, offset, sort = "appearance", version } = options;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<CharacterSearchResult[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const timeout = window.setTimeout(() => {
      loadTable(version)
        .then((loaded) => {
          if (cancelled) return;
          const { results: r, total: t } = searchLocal(
            loaded, query, sort, direction, limit, offset,
          );
          setResults(r);
          setTotal(t);
          setLoading(false);
        })
        .catch((caught) => {
          if (!cancelled) {
            setError(caught instanceof Error ? caught.message : "角色表加载失败。");
            setLoading(false);
          }
        });
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [delay, direction, limit, offset, query, sort, version]);

  return { results, total, error, loading };
}
