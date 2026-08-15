// 多人房间端到端（双 context，本地运行；需 task dev 起 Go+Next）。
// 场景：创建→加入→就绪→对局→互猜→局结果；断线→重连；刷新恢复；非法房间号 404。
import { test, expect } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import {
  normalizeQuestionScope,
  type FullCatalogSnapshot,
  type QuestionScopeConfig,
} from "@touhouflandre/shared";

type RoomCredential = {
  roomId: string;
  roomCode: string;
  guestToken: string;
  memberId: string;
  role: "player" | "spectator";
};

async function createRaceRoster(
  request: APIRequestContext,
  playerCount: number,
  playerLimit = playerCount,
  questionScope?: QuestionScopeConfig,
): Promise<RoomCredential[]> {
  const createdResponse = await request.post("/api/rooms", {
    data: {
      format: "bo3",
      mode: "race",
      playerLimit,
      displayName: "Player 1",
      ...(questionScope ? { questionScope } : {}),
    },
  });
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json();
  const credentials: RoomCredential[] = [
    {
      roomId: created.roomId,
      roomCode: created.roomCode,
      guestToken: created.guestToken,
      memberId: created.viewer.memberId,
      role: created.viewer.role,
    },
  ];
  for (let index = 2; index <= playerCount; index += 1) {
    const joinedResponse = await request.post(
      `/api/rooms/${created.roomCode}/join`,
      { data: { displayName: `Player ${index}` } },
    );
    expect(joinedResponse.status()).toBe(201);
    const joined = await joinedResponse.json();
    credentials.push({
      roomId: joined.roomId,
      roomCode: created.roomCode,
      guestToken: joined.guestToken,
      memberId: joined.viewer.memberId,
      role: joined.viewer.role,
    });
  }
  return credentials;
}

async function joinCredential(
  request: APIRequestContext,
  roomCode: string,
  displayName: string,
): Promise<RoomCredential> {
  const response = await request.post(`/api/rooms/${roomCode}/join`, {
    data: { displayName },
  });
  expect(response.status()).toBe(201);
  const joined = await response.json();
  return {
    roomId: joined.roomId,
    roomCode,
    guestToken: joined.guestToken,
    memberId: joined.viewer.memberId,
    role: joined.viewer.role,
  };
}

async function enterRoom(page: Page, credential: RoomCredential) {
  await page.addInitScript((stored) => {
    localStorage.setItem("touhouflandre:multi-room", JSON.stringify(stored));
  }, credential);
  await page.goto(`/multi/room/${credential.roomCode}`);
}

async function sendChatViaUI(page: Page, message: string) {
  const input = page.getByLabel("聊天输入");
  await expect(input).toBeEnabled({ timeout: 10_000 });
  await input.fill(message);
  await input.press("Enter");
}

async function setReady(
  request: APIRequestContext,
  credential: RoomCredential,
) {
  const response = await request.post(`/api/rooms/${credential.roomId}/ready`, {
    headers: { Authorization: `Bearer guest:${credential.guestToken}` },
    data: { ready: true },
  });
  expect(response.status()).toBe(204);
}

async function fixedAnswerScope(
  request: APIRequestContext,
  excludedNames: readonly string[] = [],
) {
  const response = await request.get("/api/catalog/full");
  expect(response.status()).toBe(200);
  const catalog = (await response.json()) as FullCatalogSnapshot;
  const answer = catalog.characters.find(
    (character) =>
      character.enabledAsAnswer &&
      character.enabledAsGuess &&
      !excludedNames.includes(character.names.zhHans),
  );
  expect(answer).toBeTruthy();
  const questionScope = normalizeQuestionScope(
    {
      catalogVersion: catalog.version,
      mode: "custom",
      difficulty: "custom",
      selectedCharacterIds: [answer!.id],
    },
    catalog,
  ).config;
  return { answerId: answer!.id, questionScope };
}

async function submitCorrectGuess(
  request: APIRequestContext,
  credential: RoomCredential,
  roundIndex: number,
  answerId: string,
) {
  const response = await request.post(
    `/api/rooms/${credential.roomId}/rounds/${roundIndex}/guess`,
    {
      headers: { Authorization: `Bearer guest:${credential.guestToken}` },
      data: { guessId: answerId, idempotencyKey: crypto.randomUUID() },
    },
  );
  expect(response.status()).toBe(200);
}

async function forfeitRound(
  request: APIRequestContext,
  credential: RoomCredential,
  roundIndex: number,
) {
  const response = await request.post(
    `/api/rooms/${credential.roomId}/rounds/${roundIndex}/forfeit`,
    {
      headers: { Authorization: `Bearer guest:${credential.guestToken}` },
    },
  );
  expect(response.status()).toBe(204);
}

async function waitForRound(
  request: APIRequestContext,
  credential: RoomCredential,
  roundIndex: number,
) {
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `/api/rooms/${credential.roomId}/snapshot`,
          {
            headers: {
              Authorization: `Bearer guest:${credential.guestToken}`,
            },
          },
        );
        if (response.status() !== 200) return "unavailable";
        const snapshot = await response.json();
        return `${snapshot.match?.roundIndex ?? 0}:${snapshot.round?.status ?? "none"}`;
      },
      { timeout: 15_000 },
    )
    .toBe(`${roundIndex}:playing`);
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
}

async function prepareVisualSnapshot(page: Page) {
  await expect(page.getByText(/实时同步连接中断/)).toHaveCount(0);
  await page.locator("[data-site-visit-count]").evaluate((element) => {
    element.textContent =
      "TouhouFlandre · 非官方东方 Project 同人项目 · 访问数 --";
  });
  await page.addStyleTag({
    content: `
      .appearance-switcher { display: none !important; }
      @media (max-width: 680px) {
        [data-site-nav-links] { display: none !important; }
        [data-guess-input-bar] { bottom: 0 !important; }
      }
    `,
  });
}

// 通过 UI 猜一个角色（搜索 + 点击建议；猜测随建议点击自动提交）。
async function guessViaUI(page: Page, query: string, index = 0) {
  const input = page.getByLabel("搜索角色");
  await input.fill(query);
  const suggestion = page.locator(".suggestion, ul li button", {
    hasText: query,
  });
  // 用建议列表的第一个（搜索词不同 → 首位通常不同）
  await expect(suggestion.nth(index)).toBeVisible();
  await suggestion.nth(index).click();
}

test.describe("多人房间", () => {
  test("创建 → 加入 → 就绪 → 对局 → 互猜 → 局结果", async ({
    browser,
    request,
  }) => {
    const { questionScope } = await fixedAnswerScope(request, [
      "博丽灵梦",
      "雾雨魔理沙",
    ]);
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    try {
      await host.addInitScript((scope) => {
        localStorage.setItem(
          "touhouflandre:question-scope",
          JSON.stringify(scope),
        );
      }, questionScope);
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
      await expect(guest.getByText("雾雨魔理沙")).toBeVisible({
        timeout: 10_000,
      });
      await expect(guest.getByText("等待对方猜测……")).toHaveCount(0);
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  test("弃权结束回合会同步给双方并推进下一局", async ({ browser }) => {
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
      await guest.getByPlaceholder(/ABC123/).press("Tab");
      await expect(guest.getByText(/房间存在/)).toBeVisible({ timeout: 5_000 });
      await guest.getByRole("button", { name: "加入房间" }).click();
      await guest.waitForURL(/\/multi\/room\//, { timeout: 10_000 });

      await host.getByRole("button", { name: "准备" }).click();
      await guest.getByRole("button", { name: "准备" }).click();
      await expect(host.getByText(/第 1 局/)).toBeVisible({ timeout: 10_000 });
      await expect(guest.getByText(/第 1 局/)).toBeVisible({ timeout: 10_000 });
      await expect(host.getByLabel("搜索角色")).toBeEnabled({
        timeout: 10_000,
      });

      await host.getByRole("button", { name: "放弃本局" }).click();
      await host.getByRole("button", { name: /再次点击确认放弃/ }).click();

      await expect(host.getByText(/本局失利/)).toBeVisible({ timeout: 10_000 });
      await expect(guest.getByText(/本局获胜/)).toBeVisible({
        timeout: 10_000,
      });
      await expect(host.getByText(/第 2 局/)).toBeVisible({ timeout: 15_000 });
      await expect(guest.getByText(/第 2 局/)).toBeVisible({ timeout: 15_000 });
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  test("接力模式共享棋盘与轮次锁定", async ({ browser, request }) => {
    const { questionScope } = await fixedAnswerScope(request, [
      "博丽灵梦",
      "雾雨魔理沙",
    ]);
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    try {
      await host.addInitScript((scope) => {
        localStorage.setItem(
          "touhouflandre:question-scope",
          JSON.stringify(scope),
        );
      }, questionScope);
      await host.goto("/multi");
      await host.locator("label", { hasText: "接力" }).click();
      await host.locator("label", { hasText: "30s" }).click();
      await host.getByRole("button", { name: "创建房间" }).click();
      await host.waitForURL(/\/multi\/room\/[A-Z2-9]{6}/);
      const roomCode = new URL(host.url()).pathname.split("/").pop()!;

      await guest.goto("/multi");
      await guest.getByPlaceholder(/ABC123/).fill(roomCode);
      await guest.getByPlaceholder(/ABC123/).press("Tab");
      await expect(guest.getByText(/房间存在 · 接力 30s/)).toBeVisible({
        timeout: 5_000,
      });
      await guest.getByRole("button", { name: "加入房间" }).click();
      await guest.waitForURL(/\/multi\/room\//, { timeout: 10_000 });

      await expect(host.getByText(/接力 30s · BO3/)).toBeVisible();

      await host.getByRole("button", { name: "准备" }).click();
      await guest.getByRole("button", { name: "准备" }).click();
      await expect(host.getByText(/第 1 局/)).toBeVisible({ timeout: 10_000 });
      await expect(host.getByLabel("搜索角色")).toBeEnabled({
        timeout: 10_000,
      });

      await guessViaUI(host, "灵梦");
      await expect(guest.getByText("博丽灵梦")).toBeVisible({
        timeout: 10_000,
      });
      await expect(host.getByLabel("搜索角色")).toBeDisabled();
      await expect(guest.getByLabel("搜索角色")).toBeEnabled();

      await guessViaUI(guest, "魔理沙");
      await expect(host.getByText("雾雨魔理沙")).toBeVisible({
        timeout: 10_000,
      });
      await expect(host.getByLabel("搜索角色")).toBeEnabled();
      await expect(guest.getByLabel("搜索角色")).toBeDisabled();
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
      await expect(host.getByText("十六夜咲夜")).toBeVisible({
        timeout: 10_000,
      });
      await host.reload();
      await expect(host.getByText("十六夜咲夜")).toBeVisible({
        timeout: 10_000,
      });
      await expect(host.getByText(/第 1 局/)).toBeVisible();
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  test("guest 断线 → host 见离线；guest 重连 → 恢复在线", async ({
    browser,
  }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    let reconnectedGuest: Page | null = null;
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
      const guestWsPromise = guest.waitForEvent("websocket", {
        predicate: (ws) => ws.url().includes("/api/rooms/"),
        timeout: 10_000,
      });
      await guest.getByRole("button", { name: "加入房间" }).click();
      await guest.waitForURL(/\/multi\/room\//, { timeout: 10_000 });
      const guestWs = await guestWsPromise;
      await guestWs.waitForEvent("framereceived", { timeout: 10_000 });
      await expect(host.getByText("在线")).toHaveCount(2, { timeout: 10_000 });

      // guest 页面关闭（WS 断开）→ host 大厅成员显示离线
      await guest.close();
      await expect(host.getByText("离线")).toBeVisible({ timeout: 10_000 });

      // guest 回到房间（同 context，localStorage 保留）→ 恢复在线
      reconnectedGuest = await guestCtx.newPage();
      await reconnectedGuest.goto(`/multi/room/${roomCode}`);
      await expect(host.getByText("离线")).toHaveCount(0, { timeout: 10_000 });
      await expect(host.getByText("在线")).toHaveCount(2, { timeout: 10_000 });
    } finally {
      await Promise.all([
        host.isClosed() ? Promise.resolve() : host.close(),
        guest.isClosed() ? Promise.resolve() : guest.close(),
        reconnectedGuest && !reconnectedGuest.isClosed()
          ? reconnectedGuest.close()
          : Promise.resolve(),
      ]);
    }
  });

  test("非法房间号 → 404；无成员资格访问 → 重定向大厅", async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await page.goto("/multi/room/ABC1");
      await expect(
        page.getByRole("heading", { name: "页面不存在" }),
      ).toBeVisible();
      // 合法格式但无本地成员资格 → 重定向 /multi
      await page.goto("/multi/room/ABC234");
      await page.waitForURL(/\/multi$/);
    } finally {
      await page.close();
    }
  });
});

test.describe("多人聊天发布闸门", () => {
  test("玩家/观战聊天可见性与闭麦行为", async ({ browser, request }) => {
    const roster = await createRaceRoster(request, 2, 2);
    const watcherA = await joinCredential(
      request,
      roster[0].roomCode,
      "Watcher A",
    );
    const watcherB = await joinCredential(
      request,
      roster[0].roomCode,
      "Watcher B",
    );
    const host = await browser.newPage();
    const guest = await browser.newPage();
    const spectatorA = await browser.newPage();
    const spectatorB = await browser.newPage();
    try {
      await Promise.all([
        enterRoom(host, roster[0]),
        enterRoom(guest, roster[1]),
        enterRoom(spectatorA, watcherA),
        enterRoom(spectatorB, watcherB),
      ]);

      await sendChatViaUI(host, "player hello");
      await expect(guest.getByText("Player 1(P1): player hello")).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        spectatorA.getByText("Player 1(P1): player hello"),
      ).toBeVisible({ timeout: 10_000 });

      await sendChatViaUI(spectatorA, "spectator hello");
      await expect(
        spectatorB.getByText("Watcher A: spectator hello"),
      ).toBeVisible({ timeout: 10_000 });
      await expect(host.getByText("Watcher A: spectator hello")).toHaveCount(
        0,
        {
          timeout: 1500,
        },
      );

      await guest.getByLabel("闭麦").click();
      await expect(guest.getByLabel("聊天输入")).toBeDisabled();
      await sendChatViaUI(host, "muted hello");
      await expect(guest.getByText("muted hello")).toHaveCount(0, {
        timeout: 1500,
      });
      await guest.getByLabel("开启聊天").click();
      await expect(guest.getByText("muted hello")).toHaveCount(0, {
        timeout: 1500,
      });
    } finally {
      await Promise.all([
        host.close(),
        guest.close(),
        spectatorA.close(),
        spectatorB.close(),
      ]);
    }
  });
});

test.describe("N 人竞速扩展", () => {
  test("创建页使用 2..8 滑动条并保留双人赛制", async ({ page }) => {
    await page.goto("/multi");
    const range = page.getByRole("slider", { name: "玩家上限（2-8）" });
    await expect(range).toHaveAttribute("min", "2");
    await expect(range).toHaveAttribute("max", "8");
    await expect(range).toHaveAttribute("step", "1");
    await expect(range).toHaveValue("2");
    await range.focus();
    await range.press("ArrowRight");
    await range.press("ArrowRight");
    await range.press("ArrowRight");
    await expect(range).toHaveValue("5");
    await expect(page.locator('output[for="create-player-limit"]')).toHaveText(
      "5 人",
    );
    await expect(page.getByText("双人赛制", { exact: true })).toBeVisible();
    await expect(page.getByText("BO3", { exact: true })).toBeVisible();
  });

  for (const count of [2, 3, 4, 8]) {
    test(`${count} 人大厅按 seat 展示容量和成员`, async ({ page, request }) => {
      const roster = await createRaceRoster(request, count, count);
      await enterRoom(page, roster[0]);

      await expect(
        page.getByText(`当前玩家 ${count}/${count}`, { exact: false }),
      ).toBeVisible();
      for (let index = 1; index <= count; index += 1) {
        await expect(
          page.getByText(`Player ${index}${index === 1 ? "（我）" : ""}`),
        ).toBeVisible();
      }
      await expectNoHorizontalOverflow(page);

      if (count === 8) {
        await prepareVisualSnapshot(page);
        await expect(page).toHaveScreenshot("race-8-lobby.png", {
          animations: "disabled",
          fullPage: true,
          mask: [page.getByRole("heading", { name: roster[0].roomCode })],
        });
      }
    });
  }

  test("8 人玩家棋盘仅挂载当前分页且对手保持匿名", async ({
    page,
    request,
  }, testInfo) => {
    const roster = await createRaceRoster(request, 8, 8);
    await enterRoom(page, roster[0]);
    for (const credential of roster) await setReady(request, credential);

    await expect(page.getByText(/第 1 局/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("搜索角色")).toBeEnabled({ timeout: 15_000 });
    await expect(page.locator("[data-member-board]")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "我" })).toBeVisible();
    await expect(page.locator("[data-member-board] table")).toHaveCount(1);
    await expect(
      page.locator("[data-member-board]").getByText(/Player \d/),
    ).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    if (testInfo.project.name === "mobile-chromium") {
      const inputBar = await page
        .locator("[data-guess-input-bar]")
        .boundingBox();
      const navigation = await page
        .locator("[data-site-nav-links]")
        .boundingBox();
      expect(inputBar).not.toBeNull();
      expect(navigation).not.toBeNull();
      expect(inputBar!.y + inputBar!.height).toBeLessThanOrEqual(navigation!.y);
    }
    await prepareVisualSnapshot(page);
    await expect(page).toHaveScreenshot("race-8-player.png", {
      animations: "disabled",
      fullPage: true,
      mask: [page.getByText(/剩余 \d/)],
    });
  });

  test("3 人玩家确认放弃后立即进入只读状态", async ({ page, request }) => {
    const roster = await createRaceRoster(request, 3, 3);
    await enterRoom(page, roster[0]);
    for (const credential of roster) await setReady(request, credential);

    const input = page.getByLabel("搜索角色");
    await expect(input).toBeEnabled({ timeout: 15_000 });
    await page.getByRole("button", { name: "放弃本局" }).click();
    await page.getByRole("button", { name: /再次点击确认放弃/ }).click();
    await expect(input).toBeDisabled();
    await expect(
      page.getByRole("status").getByText("你已放弃本局"),
    ).toBeVisible();
  });

  test("3 人积分赛淘汰玩家进入观战并展示完整排行榜", async ({
    page,
    request,
  }, testInfo) => {
    const { answerId, questionScope } = await fixedAnswerScope(request);
    const roster = await createRaceRoster(request, 3, 3, questionScope);
    await enterRoom(page, roster[2]);
    for (const credential of roster) await setReady(request, credential);
    await waitForRound(request, roster[0], 1);

    await submitCorrectGuess(request, roster[0], 1, answerId);
    await submitCorrectGuess(request, roster[1], 1, answerId);
    await forfeitRound(request, roster[2], 1);

    await expect(page.getByText("已淘汰 · 观战", { exact: false })).toBeVisible(
      {
        timeout: 15_000,
      },
    );
    await expect(page.getByLabel("搜索角色")).toHaveCount(0);
    const eliminatedScore = page
      .locator("li")
      .filter({ hasText: "Player 3（我）" })
      .filter({ hasText: "已淘汰" });
    await expect(eliminatedScore).toHaveClass(/bg-vermilion/);
    await expect(page.getByRole("button", { name: "当前棋盘" })).toBeVisible();
    const spectatorPageSize =
      testInfo.project.name === "mobile-chromium" ? 1 : 2;
    await expect(page.locator("[data-member-board]")).toHaveCount(
      spectatorPageSize,
    );
    await expectNoHorizontalOverflow(page);
    await prepareVisualSnapshot(page);
    await expect(page).toHaveScreenshot("race-eliminated.png", {
      animations: "disabled",
      fullPage: true,
      mask: [page.getByText(/剩余 \d/)],
    });

    await waitForRound(request, roster[0], 2);
    await submitCorrectGuess(request, roster[0], 2, answerId);
    await forfeitRound(request, roster[1], 2);

    await expect(page.getByText(/第 1 名 · Player 1/)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/5 分/)).toBeVisible();
    await expect(page.getByText(/第 2 名 · Player 2/)).toBeVisible();
    await expect(page.getByText(/第 3 名 · Player 3（我）/)).toBeVisible();
    await expect(page.getByText(/第 1 局淘汰/)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await prepareVisualSnapshot(page);
    await expect(page).toHaveScreenshot("race-ranking.png", {
      animations: "disabled",
      fullPage: true,
    });
  });

  test("满员观战者可在扩容后沿用身份认领席位", async ({ page, request }) => {
    const roster = await createRaceRoster(request, 2, 2);
    const spectator = await joinCredential(
      request,
      roster[0].roomCode,
      "Watcher",
    );
    expect(spectator.role).toBe("spectator");
    await enterRoom(page, spectator);
    await expect(page.getByRole("button", { name: "认领席位" })).toHaveCount(0);

    const settings = await request.patch(
      `/api/rooms/${roster[0].roomId}/settings`,
      {
        headers: { Authorization: `Bearer guest:${roster[0].guestToken}` },
        data: { playerLimit: 3 },
      },
    );
    expect(settings.status()).toBe(204);
    await expect(page.getByRole("button", { name: "认领席位" })).toBeVisible();
    await page.getByRole("button", { name: "认领席位" }).click();
    await expect(page.getByRole("button", { name: "准备" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Watcher（我）")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          JSON.parse(localStorage.getItem("touhouflandre:multi-room") ?? "{}"),
        ),
      )
      .toMatchObject({ memberId: spectator.memberId, role: "player" });
  });

  test("观战者分页查看完整棋盘且没有玩家操作", async ({
    page,
    request,
  }, testInfo) => {
    const roster = await createRaceRoster(request, 3, 3);
    const spectator = await joinCredential(
      request,
      roster[0].roomCode,
      "Watcher",
    );
    await enterRoom(page, spectator);
    for (const credential of roster) await setReady(request, credential);

    await expect(page.getByText(/观战席/)).toBeVisible({ timeout: 15_000 });
    const pageSize = testInfo.project.name === "mobile-chromium" ? 1 : 2;
    await expect(page.locator("[data-member-board]")).toHaveCount(pageSize);
    await expect(page.getByLabel("搜索角色")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /放弃/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "准备" })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await prepareVisualSnapshot(page);
    await expect(page).toHaveScreenshot("race-spectator.png", {
      animations: "disabled",
      fullPage: true,
      mask: [page.getByText(/剩余 \d/)],
    });
  });
});
