import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANNOUNCEMENTS_READ_STORAGE_KEY } from "../announcements/readState";
import type { Announcement } from "../announcements/types";
import { AnnouncementPage } from "./AnnouncementPage";

vi.mock("./AnnouncementMarkdown", () => ({
  AnnouncementMarkdown: ({ body }: { body: string }) => (
    <div data-testid="announcement-markdown">{body}</div>
  ),
}));

const markdownAnnouncement: Announcement = {
  id: "notice-markdown",
  title: "格式公告",
  date: "2026-08-08",
  pinned: true,
  fileName: "notice.md",
  body: [
    "**加粗** *斜体* <u>下划线</u> ~~腰线~~",
    "",
    "[链接](https://example.com)",
    "",
    "![公告图](./assets/banner.png)",
    "",
    "---",
  ].join("\n"),
};

describe("AnnouncementPage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders announcement metadata and body", () => {
    render(<AnnouncementPage initialAnnouncements={[markdownAnnouncement]} />);

    expect(screen.getByText("格式公告")).toBeTruthy();
    expect(screen.getByText("置顶")).toBeTruthy();
    expect(screen.getByTestId("announcement-markdown").textContent).toContain(
      "加粗",
    );
  });

  it("marks an unread announcement as read when the card is clicked", async () => {
    render(<AnnouncementPage initialAnnouncements={[markdownAnnouncement]} />);

    expect(screen.getByLabelText("未读公告")).toBeTruthy();
    await userEvent.click(screen.getByText("格式公告").closest("article")!);

    expect(screen.queryByLabelText("未读公告")).toBeNull();
    expect(localStorage.getItem(ANNOUNCEMENTS_READ_STORAGE_KEY)).toContain(
      "notice-markdown",
    );
  });

  it("refreshes announcements from the local API", async () => {
    const refreshed = {
      ...markdownAnnouncement,
      id: "notice-refreshed",
      title: "刷新后的公告",
      pinned: false,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            announcements: [refreshed],
            generatedAt: "2026-08-08T00:00:00.000Z",
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    render(<AnnouncementPage initialAnnouncements={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "刷新公告" }));

    expect(await screen.findByText("刷新后的公告")).toBeTruthy();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledOnce());
  });
});
