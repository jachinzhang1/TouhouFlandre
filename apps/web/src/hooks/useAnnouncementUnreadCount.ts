"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchAnnouncementSummary } from "../announcements/client";
import {
  ANNOUNCEMENTS_READ_STORAGE_KEY,
  ANNOUNCEMENTS_REFRESHED_EVENT,
  ANNOUNCEMENT_READ_STATE_EVENT,
  readAnnouncementIds,
} from "../announcements/readState";
import type { AnnouncementSummary } from "../announcements/types";

export function useAnnouncementUnreadCount(): number {
  const [summaries, setSummaries] = useState<AnnouncementSummary[]>([]);
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await fetchAnnouncementSummary(signal);
      setSummaries(data.announcements);
    } catch {
      setSummaries([]);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    const syncReadState = () => setRevision((value) => value + 1);
    const refetch = () => void refresh();
    const syncStorage = (event: StorageEvent) => {
      if (event.key === ANNOUNCEMENTS_READ_STORAGE_KEY) syncReadState();
    };

    window.addEventListener(ANNOUNCEMENT_READ_STATE_EVENT, syncReadState);
    window.addEventListener(ANNOUNCEMENTS_REFRESHED_EVENT, refetch);
    window.addEventListener("storage", syncStorage);
    return () => {
      window.removeEventListener(ANNOUNCEMENT_READ_STATE_EVENT, syncReadState);
      window.removeEventListener(ANNOUNCEMENTS_REFRESHED_EVENT, refetch);
      window.removeEventListener("storage", syncStorage);
    };
  }, [refresh]);

  return useMemo(() => {
    const readIds = readAnnouncementIds();
    return summaries.filter((announcement) => !readIds.has(announcement.id)).length;
  }, [summaries, revision]);
}
