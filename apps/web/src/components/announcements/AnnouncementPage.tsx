"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Megaphone, Pin } from "lucide-react";
import { fetchAnnouncements } from "../../announcements/client";
import {
  ANNOUNCEMENTS_READ_STORAGE_KEY,
  ANNOUNCEMENT_READ_STATE_EVENT,
  markAnnouncementRead,
  notifyAnnouncementsRefreshed,
  readAnnouncementIds,
} from "../../announcements/readState";
import type { Announcement } from "../../announcements/types";
import { AnnouncementMarkdown } from "./AnnouncementMarkdown";
import { Paper } from "../Paper";

export function AnnouncementPage({
  initialAnnouncements,
}: {
  initialAnnouncements: Announcement[];
}) {
  const [announcements, setAnnouncements] = useState(initialAnnouncements);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState("");
  const [tearingIds, setTearingIds] = useState<Set<string>>(() => new Set());
  const tearTimersRef = useRef<Set<number>>(new Set());

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

  useEffect(
    () => () => {
      for (const timer of tearTimersRef.current) window.clearTimeout(timer);
    },
    [],
  );

  const handleTearReadCorner = (id: string) => {
    if (readIds.has(id) || tearingIds.has(id)) return;

    setTearingIds((current) => new Set(current).add(id));
    markAnnouncementRead(id);
    setReadIds(readAnnouncementIds());

    const timer = window.setTimeout(() => {
      tearTimersRef.current.delete(timer);
      setTearingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }, 340);
    tearTimersRef.current.add(timer);
  };

  return (
    <section className="pt-10 pb-8 max-[680px]:px-[18px] max-[680px]:pt-[28px] max-[680px]:pb-[18px]">
      <header className="text-center">
        <h1 className="mt-0 mb-0 font-brand text-[2.6rem] font-black leading-[1.15] max-[680px]:text-[2.05rem]">
          公告
        </h1>
        <p
          className="mx-auto mt-3 mb-0 flex min-h-7 max-w-[720px] items-center justify-center text-center font-brand leading-[1.75] text-ink-soft"
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
          {announcements.map((announcement) => {
            const unread = !readIds.has(announcement.id);
            const tearing = tearingIds.has(announcement.id);
            return (
              <div
                className="announcement-entry-shell paper-sticker-shadow"
                key={announcement.id}
              >
                <article
                  className="announcement-entry relative p-5 pb-14 max-[680px]:p-4 max-[680px]:pb-14"
                  data-read={unread ? "false" : "true"}
                  data-tearing={tearing ? "true" : "false"}
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
                  <span
                    className="announcement-entry-cut-line"
                    aria-hidden="true"
                  />
                </article>
                {unread || tearing ? (
                  <span
                    className="announcement-tear-corner"
                    data-tearing={tearing ? "true" : "false"}
                    role={!tearing ? "button" : undefined}
                    tabIndex={!tearing ? 0 : -1}
                    aria-label={
                      !tearing
                        ? `确认已读：${announcement.title}`
                        : `${announcement.title}正在标记为已读`
                    }
                    aria-disabled={tearing || undefined}
                    onClick={() => handleTearReadCorner(announcement.id)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      handleTearReadCorner(announcement.id);
                    }}
                  >
                    <span
                      className="announcement-tear-line"
                      aria-hidden="true"
                    />
                    <span
                      className="announcement-tear-label"
                      aria-hidden="true"
                    >
                      确认
                    </span>
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <Paper
          as="div"
          variant="plain"
          foldSize={20}
          className="paper-sticker-shadow mt-8 flex min-h-[260px] items-start gap-[18px] p-6"
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
