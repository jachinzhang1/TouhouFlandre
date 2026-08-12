// GET /api/catalog/characters —— 兼容期内保留的完整可猜角色表代理。
//
// 新客户端的角色模糊搜索统一调用 /api/characters/search，不读取这里的全表。
// 此路由保留 60s 兼容缓存；上游失败时返回陈旧缓存，无缓存才返回 502。
import { NextResponse } from "next/server";
import type { components } from "../../../../generated/api";

type CatalogCharacters = components["schemas"]["CatalogCharacters"];

const API_TARGET = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:4000";
const CACHE_TTL_MS = 60_000;

let cache: { data: CatalogCharacters; fetchedAt: number } | null = null;

export const dynamic = "force-dynamic"; // 缓存由本模块管理，不依赖 Next 静态化

export async function GET(): Promise<NextResponse> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json(cache.data);
  }
  try {
    const res = await fetch(`${API_TARGET}/api/catalog/characters`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const data = (await res.json()) as CatalogCharacters;
    cache = { data, fetchedAt: now };
    return NextResponse.json(data);
  } catch (err) {
    console.error("catalog characters upstream failed", err);
    if (cache) return NextResponse.json(cache.data);
    return NextResponse.json({ error: "catalog unavailable" }, { status: 502 });
  }
}
