// GET /api/catalog/characters —— 完整可猜角色表的同源缓存代理。
//
// 架构（本地搜索缓存源）：浏览器 ← 本路由（Next 服务器缓存）← Go /api/catalog/characters。
// 表更新（seed）时 Go 侧 currentVersion 变化；本路由 TTL 60s 后重拉，响应始终带 version
// 供客户端按版本键缓存/刷新。上游失败时返回陈旧缓存（韧性），无缓存才 502。
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
