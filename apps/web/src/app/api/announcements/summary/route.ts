import { NextResponse } from "next/server";
import {
  readAnnouncements,
  toAnnouncementSummary,
} from "../../../../announcements/catalog";
import type { AnnouncementSummaryResponse } from "../../../../announcements/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse<AnnouncementSummaryResponse>> {
  const result = await readAnnouncements();
  return NextResponse.json(
    {
      announcements: result.announcements.map(toAnnouncementSummary),
      generatedAt: new Date().toISOString(),
      ...(result.warnings.length ? { warnings: result.warnings } : {}),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
