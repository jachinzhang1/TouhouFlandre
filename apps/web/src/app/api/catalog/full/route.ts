// GET /api/catalog/full —— 题库设置专用的全量快照代理。
//
// 该路径与 /api/catalog/characters 分离：角色搜索页继续只读取可猜角色缓存，
// 本地题库设置、版本修正和弹窗才读取这里的完整角色资料。
import { NextResponse } from "next/server";
import type { components } from "../../../../generated/api";

type CatalogFull = components["schemas"]["CatalogFull"];

const API_TARGET = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:4000";
const CACHE_TTL_MS = 60_000;

let cache: { data: CatalogFull; fetchedAt: number } | null = null;

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json(cache.data);
  }
  try {
    const res = await fetch(`${API_TARGET}/api/catalog/full`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const data = (await res.json()) as CatalogFull;
    cache = { data, fetchedAt: now };
    return NextResponse.json(data);
  } catch (err) {
    console.error("catalog full upstream failed", err);
    if (cache) return NextResponse.json(cache.data);
    return NextResponse.json({ error: "catalog unavailable" }, { status: 502 });
  }
}
