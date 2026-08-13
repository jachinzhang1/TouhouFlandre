"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Megaphone, Pin } from "lucide-react";
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
import { Paper } from "./Paper";

export function AnnouncementPage({
  initialAnnouncements,
}: {
  initialAnnouncements: Announcement[];
}) {
  const [announcements, setAnnouncements] = useState(initialAnnouncements);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const [refreshing, setRefreshing] = useState(true);
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
    () =>
      announcements.filter((announcement) => !readIds.has(announcement.id))
        .length,
    [announcements, readIds],
  );

  const refreshAnnouncements = useCallback(async (signal?: AbortSignal) => {
    setRefreshing(true);
    setError("");
    try {
      const data = await fetchAnnouncements(signal);
      setAnnouncements(data.announcements);
      notifyAnnouncementsRefreshed();
    } catch (refreshError) {
      if (signal?.aborted) return;
      setError(
        refreshError instanceof Error ? refreshError.message : "公告刷新失败。",
      );
    } finally {
      if (!signal?.aborted) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refreshAnnouncements(controller.signal);
    return () => controller.abort();
  }, [refreshAnnouncements]);

  const handleMarkRead = (id: string) => {
    if (readIds.has(id)) return;
    markAnnouncementRead(id);
    setReadIds(readAnnouncementIds());
  };

  return (
    <section className="pt-10 pb-8 max-[680px]:px-[18px] max-[680px]:pt-[28px] max-[680px]:pb-[18px]">
      <header>
        <h1 className="mt-0 mb-0 font-brand text-[2.6rem] font-bold leading-[1.15] max-[680px]:text-[2.05rem]">
          公告
        </h1>
        <p
          className="mt-3 mb-0 flex min-h-7 items-center leading-[1.75] text-ink-soft"
          role={refreshing ? "status" : undefined}
        >
          {refreshing
            ? "正在刷新公告……"
            : announcements.length
              ? `共有 ${announcements.length} 条公告，${unreadCount} 条未读。`
              : "当前暂无公告。"}
        </p>
      </header>

      {error ? (
        <p className="mt-4 rounded-[5px] border border-error-border bg-error-bg-soft px-4 py-3 text-sm font-bold text-error-text">
          {error}
        </p>
      ) : null}

      {announcements.length ? (
        <div className="mt-6 grid gap-4">
          {announcements.map((announcement, index) => {
            const unread = !readIds.has(announcement.id);
            return (
              <Paper
                as="article"
                variant="plain"
                foldSize={20}
                foldDelayMs={Math.min(index, 6) * 45}
                className="announcement-paper relative p-5 pb-16 max-[680px]:p-4 max-[680px]:pb-16"
                key={announcement.id}
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
                    className="font-brand text-[0.82rem] font-bold text-ink-soft"
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
                <button
                  type="button"
                  className={`absolute right-6 bottom-5 inline-flex min-h-8 items-center gap-1.5 px-3 text-xs font-bold transition-[color,background-color,box-shadow] duration-150 max-[680px]:right-5 ${
                    unread
                      ? "bg-vermilion text-[var(--paper-tinted-ink)] shadow-[0_4px_12px_var(--accent-shadow)] hover:bg-vermilion-dark"
                      : "cursor-default bg-transparent text-[var(--neutral-text)]"
                  }`}
                  aria-label={
                    unread
                      ? `将${announcement.title}标记为已读`
                      : `${announcement.title}已读`
                  }
                  aria-pressed={!unread}
                  disabled={!unread}
                  onClick={() => handleMarkRead(announcement.id)}
                >
                  <Check size={15} aria-hidden="true" />
                  已读
                </button>
              </Paper>
            );
          })}
        </div>
      ) : (
        <Paper
          as="div"
          variant="plain"
          foldSize={20}
          className="announcement-paper mt-8 flex min-h-[260px] items-start gap-[18px] p-6"
        >
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
        </Paper>
      )}
    </section>
  );
}
