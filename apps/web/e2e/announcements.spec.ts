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
    const card = page.locator("article", { hasText: "公告页启用" });

    await expect(navNotice).toBeVisible();
    await expect(card.getByLabel("未读公告")).toBeVisible();

    await card.getByRole("button", { name: "将公告页启用标记为已读" }).click();
    await expect(card.getByLabel("未读公告")).toHaveCount(0);
    await expect(navNotice).toHaveCount(0);
    await expect(page.getByRole("button", { name: "刷新公告" })).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "公告页启用" }),
    ).toBeVisible();
  });
});
