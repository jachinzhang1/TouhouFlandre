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
    mockAnnouncementsResponse([markdownAnnouncement]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders announcement metadata and body without manual refresh controls", async () => {
    render(<AnnouncementPage initialAnnouncements={[markdownAnnouncement]} />);

    expect(screen.getByText("格式公告")).toBeTruthy();
    expect(screen.getByText("置顶")).toBeTruthy();
    expect(screen.getByTestId("announcement-markdown").textContent).toContain(
      "加粗",
    );
    expect(screen.queryByRole("button", { name: "刷新公告" })).toBeNull();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledOnce());
  });

  it("only marks an unread announcement through its explicit read control", async () => {
    const user = userEvent.setup();
    render(<AnnouncementPage initialAnnouncements={[markdownAnnouncement]} />);

    const article = screen.getByText("格式公告").closest("article")!;
    expect(screen.getByLabelText("未读公告")).toBeTruthy();
    await user.click(article);
    expect(screen.getByLabelText("未读公告")).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: "将格式公告标记为已读" }),
    );

    expect(screen.queryByLabelText("未读公告")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "格式公告已读" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(localStorage.getItem(ANNOUNCEMENTS_READ_STORAGE_KEY)).toContain(
      "notice-markdown",
    );
  });

  it("refreshes announcements automatically when the page mounts", async () => {
    const refreshed = {
      ...markdownAnnouncement,
      id: "notice-refreshed",
      title: "刷新后的公告",
      pinned: false,
    };
    mockAnnouncementsResponse([refreshed]);

    render(<AnnouncementPage initialAnnouncements={[]} />);

    expect(screen.getByRole("status").textContent).toBe("正在刷新公告……");
    expect(await screen.findByText("刷新后的公告")).toBeTruthy();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledOnce());
    expect(screen.queryByRole("button", { name: "刷新公告" })).toBeNull();
  });
});

function mockAnnouncementsResponse(announcements: Announcement[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          announcements,
          generatedAt: "2026-08-08T00:00:00.000Z",
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    ),
  );
}
