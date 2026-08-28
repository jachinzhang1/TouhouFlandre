import { NextResponse } from "next/server";

const API_TARGET = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:4000";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const upstream = await fetch(`${API_TARGET}/api/catalog/search-policy`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    const headers = new Headers();
    for (const name of ["content-type", "cache-control"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (upstream.status < 200 || upstream.status >= 300) {
      headers.set("Cache-Control", "no-store");
    }
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    console.error("catalog search policy upstream failed", error);
    return NextResponse.json(
      { code: "CATALOG_NOT_READY", error: "搜索策略暂时不可用。" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
