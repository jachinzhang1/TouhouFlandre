"use client";

import { useEffect, useMemo, useState } from "react";
import { Megaphone, Pin, RefreshCw } from "lucide-react";
import { fetchAnnouncements } from "../announcements/client";
import {
  ANNOUNCEMENTS_READ_STORAGE_KEY,
  ANNOUNCEMENT_READ_STATE_EVENT,
  markAnnouncementRead,
  notifyAnnouncementsRefreshed,
  readAnnouncementIds,
} from "../announcements/readState";
import type { Announcement } from "../announcements/types";
import { AnnouncementMarkdown } from "./AnnouncementMarkdown";

export function AnnouncementPage({
  initialAnnouncements,
}: {
  initialAnnouncements: Announcement[];
}) {
  const [announcements, setAnnouncements] = useState(initialAnnouncements);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const syncReadIds = () => setReadIds(readAnnouncementIds());
    const syncStorage = (event: StorageEvent) => {
      if (event.key === ANNOUNCEMENTS_READ_STORAGE_KEY) syncReadIds();
    };

    syncReadIds();
    window.addEventListener(ANNOUNCEMENT_READ_STATE_EVENT, syncReadIds);
    window.addEventListener("storage", syncStorage);
    return () => {
      window.removeEventListener(ANNOUNCEMENT_READ_STATE_EVENT, syncReadIds);
      window.removeEventListener("storage", syncStorage);
    };
  }, []);

  const unreadCount = useMemo(
    () => announcements.filter((announcement) => !readIds.has(announcement.id)).length,
    [announcements, readIds],
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    setError("");
    try {
      const data = await fetchAnnouncements();
      setAnnouncements(data.announcements);
      notifyAnnouncementsRefreshed();
    } catch (refreshError) {
      setError(
        refreshError instanceof Error ? refreshError.message : "公告刷新失败。",
      );
    } finally {
      setRefreshing(false);
    }
  };

  const handleAnnouncementClick = (id: string) => {
    if (readIds.has(id)) return;
    markAnnouncementRead(id);
    setReadIds(readAnnouncementIds());
  };

  return (
    <section className="px-[18px] pt-10 pb-8 max-[680px]:pt-[28px] max-[680px]:pb-[18px]">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div className="max-w-[720px]">
          <p className="mt-0 mb-2 text-[0.69rem] font-black tracking-[0.12em] text-vermilion">
            ANNOUNCEMENTS
          </p>
          <h1 className="mt-0 mb-0 font-brand text-[2.6rem] font-bold leading-[1.15] max-[680px]:text-[2.05rem]">
            公告
          </h1>
          <p className="mt-3 mb-0 leading-[1.75] text-ink-soft">
            {announcements.length
              ? `共有 ${announcements.length} 条公告，${unreadCount} 条未读。`
              : "当前暂无公告。"}
          </p>
        </div>
        <button
          type="button"
          className="secondary-button px-4"
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          aria-label="刷新公告"
        >
          <RefreshCw
            size={17}
            aria-hidden="true"
            className={refreshing ? "animate-spin" : undefined}
          />
          <span>{refreshing ? "刷新中" : "刷新"}</span>
        </button>
      </header>

      {error ? (
        <p className="mt-4 rounded-[5px] border border-error-border bg-error-bg-soft px-4 py-3 text-sm font-bold text-error-text">
          {error}
        </p>
      ) : null}

      {announcements.length ? (
        <div className="mt-6 grid gap-4">
          {announcements.map((announcement) => {
            const unread = !readIds.has(announcement.id);
            return (
              <article
                key={announcement.id}
                className="relative rounded-[6px] border border-line bg-paper p-5 shadow-sm transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-[1px] hover:border-[var(--accent-hover-border)] hover:shadow-lg max-[680px]:p-4"
                onClick={() => handleAnnouncementClick(announcement.id)}
              >
                {unread ? (
                  <span
                    className="absolute right-4 top-4 size-[9px] rounded-full bg-[#e5484d] shadow-[0_0_0_4px_rgba(229,72,77,0.16)]"
                    aria-label="未读公告"
                    title="未读公告"
                  />
                ) : null}
                <div className="flex flex-wrap items-center gap-2 pr-5">
                  {announcement.pinned ? (
                    <span className="inline-flex h-6 items-center gap-1 rounded-[4px] bg-vermilion-soft px-2 text-[0.72rem] font-black text-vermilion">
                      <Pin size={13} aria-hidden="true" />
                      置顶
                    </span>
                  ) : null}
                  <time
                    className="text-[0.78rem] font-bold text-ink-soft"
                    dateTime={announcement.date}
                  >
                    {announcement.date}
                  </time>
                </div>
                <h2 className="mt-3 mb-0 font-brand text-[1.55rem] font-bold leading-[1.25] text-ink max-[680px]:text-[1.34rem]">
                  {announcement.title}
                </h2>
                <div className="mt-4">
                  <AnnouncementMarkdown body={announcement.body} />
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="mt-8 flex min-h-[260px] items-start gap-[18px] rounded-[6px] border border-line bg-paper p-6">
          <span className="inline-flex size-[48px] shrink-0 items-center justify-center rounded-[6px] bg-vermilion-soft text-vermilion">
            <Megaphone size={24} aria-hidden="true" />
          </span>
          <div>
            <h2 className="mt-0 mb-2 font-brand text-[1.5rem] font-bold">
              暂无公告
            </h2>
            <p className="m-0 leading-[1.75] text-ink-soft">
              服务器公告目录中还没有可展示的 Markdown 文件。
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
