import { NextResponse } from "next/server";

const API_TARGET = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:4000";

export const dynamic = "force-dynamic";

function responseHeaders(upstream: Response): Headers {
  const headers = new Headers();
  for (const name of ["content-type", "cache-control", "etag"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (upstream.status < 200 || upstream.status >= 400) {
    headers.set("Cache-Control", "no-store");
  }
  return headers;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ catalogVersion: string; indexSchemaVersion: string }> },
): Promise<NextResponse> {
  const { catalogVersion, indexSchemaVersion } = await params;
  const headers = new Headers({ accept: "application/json" });
  const ifNoneMatch = request.headers.get("If-None-Match");
  if (ifNoneMatch) headers.set("If-None-Match", ifNoneMatch);
  try {
    const upstream = await fetch(
      `${API_TARGET}/api/catalog/${encodeURIComponent(catalogVersion)}/search-index/${encodeURIComponent(indexSchemaVersion)}`,
      { cache: "no-store", headers },
    );
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: responseHeaders(upstream),
    });
  } catch (error) {
    console.error("catalog search index upstream failed", error);
    return NextResponse.json(
      { code: "CATALOG_NOT_READY", error: "题库搜索索引暂时不可用。" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
