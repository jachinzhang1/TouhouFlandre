import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  normalizeQuestionScope,
  type FullCatalogSnapshot,
} from "@touhouflandre/shared";

test.describe.configure({ timeout: 45_000 });

async function catalog(request: APIRequestContext) {
  const response = await request.get("/api/catalog/full");
  expect(response.status()).toBe(200);
  return (await response.json()) as FullCatalogSnapshot;
}

function scopeFor(snapshot: FullCatalogSnapshot, ...names: string[]) {
  const characters = names.map((name) => {
    const character = snapshot.characters.find(
      (candidate) => candidate.names.zhHans === name,
    );
    expect(character?.enabledAsAnswer).toBe(true);
    return character!;
  });
  return normalizeQuestionScope(
    {
      catalogVersion: snapshot.version,
      mode: "custom",
      difficulty: "custom",
      selectedCharacterIds: characters.map((character) => character.id),
    },
    snapshot,
  ).config;
}

test("catalog uses scoped @ queries through the local index", async ({
  page,
}) => {
  const indexReady = page.waitForResponse(
    (response) =>
      response.url().includes("/search-index/") && response.status() === 200,
  );
  await page.goto("/search");
  await (await indexReady).finished();
  const input = page.getByLabel("搜索角色");
  await input.fill("咲夜@红魔乡");
  await expect(page.getByText("十六夜咲夜", { exact: true })).toBeVisible();

  const remoteRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/characters/search") {
      remoteRequests.push(request.url());
    }
  });
  await input.fill("咲夜@妖妖梦");
  await expect(page.getByText("十六夜咲夜", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("没有找到匹配的角色。", { exact: true }),
  ).toBeVisible();
  expect(remoteRequests).toEqual([]);
});

test.describe("main features on the polished game pages", () => {
  test.skip(
    process.env.HSO007_ALLOW_WRITES !== "1",
    "Requires HSO007_ALLOW_WRITES=1 with a disposable database",
  );

  test("re-entering random mode uses the newly selected question scope", async ({
    page,
    request,
  }) => {
    const snapshot = await catalog(request);
    const firstScope = scopeFor(snapshot, "博丽灵梦");
    const nextScope = scopeFor(snapshot, "雾雨魔理沙");
    const resolves: Array<Record<string, unknown>> = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/puzzles/random/resolve") {
        resolves.push(request.postDataJSON());
      }
    });
    await page.goto("/single");
    await page.evaluate((scope) => {
      localStorage.setItem(
        "touhouflandre:question-scope",
        JSON.stringify(scope),
      );
    }, firstScope);
    await page.goto("/single/random");
    await expect(page.getByLabel("搜索东方角色")).toBeEnabled();
    const firstSessionId = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("touhouflandre:random-session")!).id,
    );

    await page.goto("/single");
    await page.evaluate((scope) => {
      localStorage.setItem(
        "touhouflandre:question-scope",
        JSON.stringify(scope),
      );
    }, nextScope);
    await page.goto("/single/random");
    await expect(page.getByLabel("搜索东方角色")).toBeEnabled();
    const nextSessionId = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("touhouflandre:random-session")!).id,
    );
    expect(nextSessionId).not.toBe(firstSessionId);
    expect(resolves).toHaveLength(2);
    expect(resolves[1]).toMatchObject({
      resumeSessionId: firstSessionId,
      questionScope: { selectedCharacterIds: nextScope.selectedCharacterIds },
    });
    for (const id of [firstSessionId, nextSessionId]) {
      expect((await request.post(`/api/sessions/${id}/forfeit`)).status()).toBe(
        200,
      );
    }
  });

  for (const mode of ["race", "relay"] as const) {
    test(`${mode} passes the host scope into local suggestions and submits a guess`, async ({
      page,
      request,
    }) => {
      const scope = scopeFor(
        await catalog(request),
        "博丽灵梦",
        "雾雨魔理沙",
        "十六夜咲夜",
      );
      await page.goto("/multi");
      await page.evaluate((value) => {
        localStorage.setItem(
          "touhouflandre:question-scope",
          JSON.stringify(value),
        );
      }, scope);
      if (mode === "relay") {
        await page.getByRole("button", { name: /接力/ }).click();
      }
      const created = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/rooms" &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "创建房间" }).click();
      const host = await (await created).json();
      await expect(page).toHaveURL(`/multi/room/${host.roomCode}`);
      const joined = await request.post(`/api/rooms/${host.roomCode}/join`, {
        data: { displayName: "Integration guest" },
      });
      expect(joined.status()).toBe(201);
      const guest = await joined.json();
      try {
        const indexReady = page.waitForResponse(
          (response) =>
            response.url().includes("/search-index/") &&
            response.status() === 200,
        );
        for (const member of [host, guest]) {
          const ready = await request.post(`/api/rooms/${host.roomId}/ready`, {
            headers: { Authorization: `Bearer guest:${member.guestToken}` },
            data: { ready: true },
          });
          expect(ready.status()).toBe(204);
        }
        await (await indexReady).finished();
        const input = page.getByLabel("搜索角色");
        await expect(input).toBeEnabled({ timeout: 15_000 });
        const remoteRequests: string[] = [];
        page.on("request", (request) => {
          if (new URL(request.url()).pathname === "/api/characters/search") {
            remoteRequests.push(request.url());
          }
        });
        await input.fill("八云紫");
        await expect(
          page.getByText("没有找到匹配角色", { exact: true }),
        ).toBeVisible();
        await input.fill("灵梦");
        const option = page.getByRole("option", { name: /博丽灵梦/ });
        await expect(option).toBeVisible();
        expect(remoteRequests).toEqual([]);
        const submitted = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname.startsWith(
              `/api/rooms/${host.roomId}/`,
            ) && response.request().method() === "POST",
        );
        await option.click();
        expect((await submitted).status()).toBeLessThan(300);
        await expect(
          page.getByRole("rowheader", { name: /博丽灵梦/ }).first(),
        ).toBeVisible();
      } finally {
        for (const member of [host, guest]) {
          const left = await request.post(`/api/rooms/${host.roomId}/leave`, {
            headers: { Authorization: `Bearer guest:${member.guestToken}` },
          });
          expect(left.status()).toBe(204);
        }
      }
    });
  }
});
