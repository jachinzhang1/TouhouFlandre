export const ANNOUNCEMENTS_READ_STORAGE_KEY = "touhouflandre:read-announcements";
export const ANNOUNCEMENT_READ_STATE_EVENT =
  "touhouflandre:announcement-read-state-changed";
export const ANNOUNCEMENTS_REFRESHED_EVENT =
  "touhouflandre:announcements-refreshed";

export function readAnnouncementIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(ANNOUNCEMENTS_READ_STORAGE_KEY) ?? "[]",
    );
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}

export function markAnnouncementRead(id: string): void {
  if (typeof window === "undefined") return;
  const ids = readAnnouncementIds();
  ids.add(id);
  window.localStorage.setItem(
    ANNOUNCEMENTS_READ_STORAGE_KEY,
    JSON.stringify([...ids].sort()),
  );
  window.dispatchEvent(new CustomEvent(ANNOUNCEMENT_READ_STATE_EVENT));
}

export function notifyAnnouncementsRefreshed(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ANNOUNCEMENTS_REFRESHED_EVENT));
}
