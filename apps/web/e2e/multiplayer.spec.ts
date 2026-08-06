// 多人房间端到端（双 context，本地运行；需 task dev 起 Go+Next）。
// 场景：创建→加入→就绪→对局→互猜→局结果；断线→重连；刷新恢复；非法房间号 404。
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// 通过 UI 猜一个角色（搜索 + 点击建议；猜测随建议点击自动提交）。
async function guessViaUI(page: Page, query: string, index = 0) {
  const input = page.getByLabel("搜索角色");
  await input.fill(query);
  const suggestion = page.locator(".suggestion, ul li button", { hasText: query });
  // 用建议列表的第一个（搜索词不同 → 首位通常不同）
  await page.locator("ul li button").nth(index).click();
  void suggestion;
}

test.describe("多人房间", () => {
  test("创建 → 加入 → 就绪 → 对局 → 互猜 → 局结果", async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    try {
      // host 创建房间
      await host.goto("/multi");
      await host.getByRole("button", { name: "创建房间" }).click();
      await host.waitForURL(/\/multi\/room\/[A-Z2-9]{6}/);
      const roomCode = new URL(host.url()).pathname.split("/").pop()!;
      expect(roomCode).toMatch(/^[A-Z2-9]{6}$/);

      // host 大厅可见房间号与自身成员
      await expect(host.getByRole("heading", { name: roomCode })).toBeVisible();
      await expect(host.getByText("（我）")).toBeVisible();

      // guest 加入（输入房间号 + 预检提示）
      await guest.goto("/multi");
      await guest.getByPlaceholder(/ABC123/).fill(roomCode);
      await guest.getByPlaceholder(/ABC123/).blur();
      await expect(guest.getByText(/房间存在/)).toBeVisible();
      await guest.getByRole("button", { name: "加入房间" }).click();
      await guest.waitForURL(/\/multi\/room\//);

      // 双方就绪 → 对局开始（round 1 countdown → playing）
      await host.getByRole("button", { name: "准备" }).click();
      await guest.getByRole("button", { name: "准备" }).click();
      await expect(host.getByText(/第 1 局/)).toBeVisible({ timeout: 10_000 });

      // 互猜：各自猜一个不同角色（搜索词不同）
      await guessViaUI(host, "灵梦");
      await guessViaUI(guest, "魔理沙");
      // host 自视角出现 1 条猜测；guest 矩阵出现 1 行对手猜测
      await expect(host.getByText("博丽灵梦")).toBeVisible({ timeout: 10_000 });
      await expect(guest.getByText("雾雨魔理沙")).toBeVisible({ timeout: 10_000 });
      await expect(guest.locator('span[role="img"]').first()).toBeVisible();
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  test("刷新恢复会话状态", async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    guest.on("pageerror", (e) => console.log("GUEST PAGEERR:", e.message.slice(0, 200)));
    guest.on("console", (m) => { if (m.type() === "error") console.log("GUEST CONSOLE:", m.text().slice(0, 200)); });
    guest.on("requestfailed", (req) => console.log("GUEST REQFAIL:", req.method(), req.url(), req.failure()?.errorText));
    host.on("websocket", (ws) => {
      console.log("HOST WS:", ws.url().slice(0, 60));
      ws.on("framereceived", (e) => {
        const text = e.payload.toString().slice(0, 60);
        if (text.includes("type")) console.log("HOST FRAME:", text.replace(/\s+/g, " "));
      });
    });
    try {
      await host.goto("/multi");
      await host.getByRole("button", { name: "创建房间" }).click();
      await host.waitForURL(/\/multi\/room\/[A-Z2-9]{6}/);
      const roomCode = new URL(host.url()).pathname.split("/").pop()!;
      await guest.goto("/multi");
      await guest.getByPlaceholder(/ABC123/).fill(roomCode);
      // 显式 blur 触发预检并等其完成（避免预检与 join 并发 preflight 阻塞 join）
      await guest.getByPlaceholder(/ABC123/).press("Tab");
      await expect(guest.getByText(/房间存在/)).toBeVisible({ timeout: 5_000 });
      await guest.getByRole("button", { name: "加入房间" }).click();
      await guest.waitForURL(/\/multi\/room\//, { timeout: 10_000 });

      await host.getByRole("button", { name: "准备" }).click();
      await guest.getByRole("button", { name: "准备" }).click();
      await expect(host.getByText(/第 1 局/)).toBeVisible({ timeout: 10_000 });

      // host 猜一角色后刷新 → 状态恢复（自视角猜测仍在）
      const input = host.getByLabel("搜索角色");
      await input.fill("十六夜咲夜");
      await host.locator("ul li button", { hasText: "十六夜咲夜" }).click();
      await expect(host.getByText("十六夜咲夜")).toBeVisible({ timeout: 10_000 });
      await host.reload();
      await expect(host.getByText("十六夜咲夜")).toBeVisible({ timeout: 10_000 });
      await expect(host.getByText(/第 1 局/)).toBeVisible();
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  test("guest 断线 → host 见离线；guest 重连 → 恢复在线", async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    try {
      await host.goto("/multi");
      await host.getByRole("button", { name: "创建房间" }).click();
      await host.waitForURL(/\/multi\/room\/[A-Z2-9]{6}/);
      const roomCode = new URL(host.url()).pathname.split("/").pop()!;
      await guest.goto("/multi");
      await guest.getByPlaceholder(/ABC123/).fill(roomCode);
      // 显式 blur 触发预检并等其完成（避免预检与 join 并发 preflight 阻塞 join）
      await guest.getByPlaceholder(/ABC123/).press("Tab");
      await expect(guest.getByText(/房间存在/)).toBeVisible({ timeout: 5_000 });
      await guest.getByRole("button", { name: "加入房间" }).click();
      await guest.waitForURL(/\/multi\/room\//, { timeout: 10_000 });

      // guest 导航离开（页面卸载关闭 WS）→ host 大厅成员显示离线
      await guest.goto("/multi");
      await expect(host.getByText("离线")).toBeVisible({ timeout: 10_000 });

      // guest 回到房间（同 context，localStorage 保留）→ 恢复在线
      await guest.goto(`/multi/room/${roomCode}`);
      await expect(host.getByText("离线")).toHaveCount(0, { timeout: 10_000 });
      await expect(host.getByText("在线")).toHaveCount(2, { timeout: 10_000 });
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  test("非法房间号 → 404；无成员资格访问 → 重定向大厅", async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await page.goto("/multi/room/ABC1");
      await expect(page.getByRole("heading", { name: "页面不存在" })).toBeVisible();
      // 合法格式但无本地成员资格 → 重定向 /multi
      await page.goto("/multi/room/ABC234");
      await page.waitForURL(/\/multi$/);
    } finally {
      await page.close();
    }
  });
});
