import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { resolveAnnouncementAsset } from "../../../../../announcements/catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path?: string[] }> },
): Promise<NextResponse> {
  const { path = [] } = await params;
  const asset = resolveAnnouncementAsset(path);
  if (!asset) {
    return NextResponse.json({ error: "asset not found" }, { status: 404 });
  }

  try {
    const bytes = await readFile(asset.path);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": asset.contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "asset not found" }, { status: 404 });
  }
}
