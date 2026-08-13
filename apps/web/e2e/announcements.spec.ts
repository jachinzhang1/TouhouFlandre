import { expect, test } from "@playwright/test";

test.describe("公告页", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.clear());
  });

  test("展示公告并按本浏览器标记已读", async ({ page }) => {
    await page.goto("/announcement");

    await expect(
      page.getByRole("heading", { name: "公告", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "公告页启用" }),
    ).toBeVisible();
    await expect(page.getByText("加粗")).toBeVisible();
    await expect(page.getByText("斜体")).toBeVisible();
    await expect(page.getByText("下划线")).toBeVisible();
    await expect(page.getByText("腰线")).toBeVisible();

    const navNotice = page
      .locator(".nav-link", { hasText: "公告" })
      .locator(".nav-unread-dot");
    const entry = page.locator(".announcement-entry-shell", {
      hasText: "公告页启用",
    });
    const card = entry.locator("article");

    await expect(navNotice).toBeVisible();
    await expect(card.getByLabel("未读公告")).toBeVisible();

    await entry.getByRole("button", { name: "确认已读：公告页启用" }).click();
    await expect(card).toHaveAttribute("data-read", "true");
    await expect(entry.locator(".announcement-tear-corner")).toHaveCount(0);
    await expect(card.locator(".announcement-entry-cut-line")).toBeVisible();
    await expect(card.getByLabel("未读公告")).toHaveCount(0);
    await expect(navNotice).toHaveCount(0);
    await expect(page.getByRole("button", { name: "刷新公告" })).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "公告页启用" }),
    ).toBeVisible();
  });
});
