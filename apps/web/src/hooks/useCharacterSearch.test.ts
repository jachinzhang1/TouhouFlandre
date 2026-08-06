// 本地角色搜索（useCharacterSearch/searchLocal）：匹配、排序、分页与版本键缓存。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { CharacterSearchResult } from "@touhouflandre/shared";
import { searchLocal, useCharacterSearch } from "./useCharacterSearch";

const CHARS: CharacterSearchResult[] = [
  {
    id: "reimu_hakurei",
    name: "博丽灵梦",
    subtitle: "Reimu Hakurei · 东方灵异传",
    initials: "博丽",
    avatarUrl: "/c.png",
    appearanceOrder: 1,
    searchText: "博丽灵梦reimu_hakurei东方灵异传touhou1",
    nameSortKey: "bolilingmeng",
    firstAppearance: { workTitle: "东方灵异传", releaseYear: 1996 },
    species: ["人类"],
    locations: [],
    affiliations: [],
    hairColors: [],
  },
  {
    id: "marisa_kirisame",
    name: "雾雨魔理沙",
    subtitle: "Marisa Kirisame · 东方红魔乡",
    initials: "雾雨",
    avatarUrl: "/c.png",
    appearanceOrder: 2,
    searchText: "雾雨魔理沙marisa_kirisame东方红魔乡touhou6",
    nameSortKey: "wuyumolisha",
    firstAppearance: { workTitle: "东方红魔乡", releaseYear: 2002 },
    species: ["人类"],
    locations: [],
    affiliations: [],
    hairColors: [],
  },
  {
    id: "keine_kamishirasawa",
    name: "上白泽慧音",
    subtitle: "Keine Kamishirasawa · 东方永夜抄",
    initials: "上白",
    avatarUrl: "/c.png",
    appearanceOrder: 10,
    searchText: "上白泽慧音keine_kamishirasawa东方永夜抄touhou8",
    nameSortKey: "shangbaizehuiyin",
    firstAppearance: { workTitle: "东方永夜抄", releaseYear: 2004 },
    species: ["妖兽"],
    locations: [],
    affiliations: [],
    hairColors: [],
  },
];

const TABLE = { version: "v1", characters: CHARS };

function fetchMockOk(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
  });
}

describe("searchLocal", () => {
  it("按 searchText 子串匹配（与服务器 ILIKE 同源语义）", () => {
    const { results } = searchLocal(TABLE, "上白泽慧音", "appearance", "asc", undefined, undefined);
    expect(results.map((r) => r.id)).toEqual(["keine_kamishirasawa"]);
  });

  it("匹配归一的英文/别名文本", () => {
    const { results } = searchLocal(TABLE, "reimu", "appearance", "asc", undefined, undefined);
    expect(results.map((r) => r.id)).toEqual(["reimu_hakurei"]);
  });

  it("空查询返回全部（与服务器一致）", () => {
    const { results, total } = searchLocal(TABLE, "", "appearance", "asc", undefined, undefined);
    expect(total).toBe(3);
    expect(results).toHaveLength(3);
  });

  it("按登场顺序/名称排序 + 方向", () => {
    const byNameAsc = searchLocal(TABLE, "", "name", "asc", undefined, undefined);
    expect(byNameAsc.results[0].id).toBe("reimu_hakurei"); // bolilingmeng 最小
    // 'shangbaizehuiyin'(s) < 'wuyumolisha'(w) → desc 首位为魔理沙
    const byNameDesc = searchLocal(TABLE, "", "name", "desc", undefined, undefined);
    expect(byNameDesc.results[0].id).toBe("marisa_kirisame");
    const byAppearanceDesc = searchLocal(TABLE, "", "appearance", "desc", undefined, undefined);
    expect(byAppearanceDesc.results[0].id).toBe("keine_kamishirasawa");
  });

  it("limit/offset 分页", () => {
    const { results, total } = searchLocal(TABLE, "", "appearance", "asc", 2, 1);
    expect(total).toBe(3);
    expect(results.map((r) => r.id)).toEqual(["marisa_kirisame", "keine_kamishirasawa"]);
  });
});

describe("useCharacterSearch", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMockOk(TABLE));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("拉取全表并本地过滤", async () => {
    const { result } = renderHook(() => useCharacterSearch("灵梦", { limit: 12 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.results.map((r) => r.id)).toEqual(["reimu_hakurei"]);
    expect(result.current.total).toBe(1);
    expect(fetch).toHaveBeenCalledWith("/api/catalog/characters");
  });

  it("不同版本键触发独立拉取（表更新后新局按新版本刷新）", async () => {
    const { result, unmount } = renderHook(() => useCharacterSearch("", { limit: 12, version: "v1" }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    unmount();
    const v2 = { version: "v2", characters: CHARS };
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(v2),
    } as never);
    const { result: r2 } = renderHook(() => useCharacterSearch("", { limit: 12, version: "v2" }));
    await waitFor(() => expect(r2.current.loading).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("拉取失败给出错误信息（独立版本键，避开模块级缓存）", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 502 } as never);
    const { result } = renderHook(() => useCharacterSearch("灵梦", { version: "v-fail" }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
  });
});
