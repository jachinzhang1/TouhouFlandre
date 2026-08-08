import { NextResponse } from "next/server";
import { readAnnouncements } from "../../../announcements/catalog";
import type { AnnouncementsResponse } from "../../../announcements/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse<AnnouncementsResponse>> {
  const result = await readAnnouncements();
  return NextResponse.json(
    {
      announcements: result.announcements,
      generatedAt: new Date().toISOString(),
      ...(result.warnings.length ? { warnings: result.warnings } : {}),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
