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
    const title = "重要更新#2 - 多人联机功能更新";
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(
      page.getByText("观战功能", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("多人竞速模式人数上限提升", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("聊天系统", { exact: true }).first(),
    ).toBeVisible();

    const navNotice = page.locator(
      '.nav-links > a.nav-link[href="/announcement"] .nav-unread-dot',
    );
    const entry = page.locator(".announcement-entry-shell", {
      hasText: title,
    });
    const card = entry.locator("article");

    if ((page.viewportSize()?.width ?? 0) <= 680) {
      await page.getByRole("button", { name: "展开站点导航" }).click();
      await expect(navNotice).toBeVisible();
      await page.getByRole("button", { name: "关闭站点导航" }).click();
    } else {
      await expect(navNotice).toBeVisible();
    }
    await expect(card.getByLabel("未读公告")).toBeVisible();

    await entry
      .getByRole("button", { name: `确认已读：${title}` })
      .click({ position: { x: 60, y: 60 } });
    await expect(card).toHaveAttribute("data-read", "true");
    await expect(entry.locator(".announcement-tear-corner")).toHaveCount(0);
    await expect(card.locator(".announcement-entry-cut-line")).toBeVisible();
    await expect(card.getByLabel("未读公告")).toHaveCount(0);
    await expect(navNotice).toHaveCount(1);
    await expect(page.getByRole("button", { name: "刷新公告" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  });
});
