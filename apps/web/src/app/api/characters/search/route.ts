import { NextResponse } from "next/server";

const API_TARGET = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:4000";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const headers = new Headers({ accept: "application/json" });
  const fallbackReason = request.headers.get("X-Character-Search-Fallback-Reason");
  if (fallbackReason !== null) headers.set("X-Character-Search-Fallback-Reason", fallbackReason);
  try {
    const upstream = await fetch(`${API_TARGET}/api/characters/search${url.search}`, {
      cache: "no-store",
      headers,
    });
    const responseHeaders = new Headers();
    for (const name of ["content-type", "cache-control", "etag"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    if (upstream.status < 200 || upstream.status >= 300) {
      responseHeaders.set("Cache-Control", "no-store");
    }
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("character search upstream failed", error);
    return NextResponse.json(
      { code: "INTERNAL", error: "搜索服务暂时不可用。" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
