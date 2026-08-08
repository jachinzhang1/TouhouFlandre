import type {
  AnnouncementsResponse,
  AnnouncementSummaryResponse,
} from "./types";

export async function fetchAnnouncements(
  signal?: AbortSignal,
): Promise<AnnouncementsResponse> {
  const response = await fetch("/api/announcements", {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error("公告读取失败。");
  return (await response.json()) as AnnouncementsResponse;
}

export async function fetchAnnouncementSummary(
  signal?: AbortSignal,
): Promise<AnnouncementSummaryResponse> {
  const response = await fetch("/api/announcements/summary", {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error("公告摘要读取失败。");
  return (await response.json()) as AnnouncementSummaryResponse;
}
