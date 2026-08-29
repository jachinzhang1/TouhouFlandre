import { expect, test, type APIRequestContext } from "@playwright/test";
import type { CatalogSearchIndex } from "@touhouflandre/shared";
import { gzipSync } from "node:zlib";
import { searchCharacters } from "../src/features/character-search/engine";

test.describe.configure({ mode: "serial", timeout: 120_000 });

const API_BASE_URL = process.env.HSO007_API_BASE_URL ?? "http://127.0.0.1:4000";
const ALLOW_WRITES = process.env.HSO007_ALLOW_WRITES === "1";
const EXPECT_LEGACY_API = process.env.HSO007_EXPECT_LEGACY_API === "1";
const EXPECT_LEGACY_WEB = process.env.HSO007_EXPECT_LEGACY_WEB === "1";
const INDEX_GZIP_BUDGET_BYTES = Number(
  process.env.HSO007_INDEX_GZIP_BUDGET_BYTES ?? 90_900,
);

async function currentCatalogVersion(
  request: APIRequestContext,
): Promise<string> {
  const response = await request.get(`${API_BASE_URL}/api/catalog`);
  expect(response.status()).toBe(200);
  const catalog = (await response.json()) as { version?: string };
  expect(catalog.version).toBeTruthy();
  return catalog.version!;
}

async function expectLocalPrimary(request: APIRequestContext): Promise<string> {
  const response = await request.get(
    `${API_BASE_URL}/api/catalog/search-policy`,
  );
  expect(response.status()).toBe(200);
  const policy = (await response.json()) as { mode?: string };
  test.skip(
    policy.mode !== "local-primary",
    "HSO-007 local-primary scenarios require CHARACTER_SEARCH_MODE=local-primary",
  );
  return currentCatalogVersion(request);
}

type SearchAssembly = {
  label: "catalog" | "single" | "race" | "relay";
  catalogVersion: string;
  selectedCharacterIds?: string[];
  remoteContext: Record<string, string>;
};

type RoomCredential = {
  roomId: string;
  roomCode: string;
  guestToken: string;
};

async function createMultiplayerAssembly(
  request: APIRequestContext,
  mode: "race" | "relay",
): Promise<{ assembly: SearchAssembly; roster: RoomCredential[] }> {
  const createdResponse = await request.post(`${API_BASE_URL}/api/rooms`, {
    data: {
      format: "bo3",
      mode,
      playerLimit: 2,
      displayName: `${mode} parity host`,
      ...(mode === "race"
        ? { raceEliminationEnabled: false }
        : { relayEliminationEnabled: false, turnSeconds: 60 }),
    },
  });
  expect(createdResponse.status()).toBe(201);
  const created = (await createdResponse.json()) as RoomCredential;
  const joinedResponse = await request.post(
    `${API_BASE_URL}/api/rooms/${created.roomCode}/join`,
    { data: { displayName: `${mode} parity guest` } },
  );
  expect(joinedResponse.status()).toBe(201);
  const joined = (await joinedResponse.json()) as Omit<
    RoomCredential,
    "roomCode"
  >;
  const roster = [created, { ...joined, roomCode: created.roomCode }];

  for (const credential of roster) {
    const ready = await request.post(
      `${API_BASE_URL}/api/rooms/${credential.roomId}/ready`,
      {
        headers: {
          Authorization: `Bearer guest:${credential.guestToken}`,
        },
        data: { ready: true },
      },
    );
    expect(ready.status()).toBe(204);
  }
  const snapshotResponse = await request.get(
    `${API_BASE_URL}/api/rooms/${created.roomId}/snapshot`,
    {
      headers: { Authorization: `Bearer guest:${created.guestToken}` },
    },
  );
  expect(snapshotResponse.status()).toBe(200);
  const snapshot = (await snapshotResponse.json()) as {
    match?: {
      matchIndex: number;
      catalogVersion: string;
      questionScope?: { selectedCharacterIds: string[] };
    };
  };
  expect(snapshot.match?.catalogVersion).toBeTruthy();
  expect(
    snapshot.match?.questionScope?.selectedCharacterIds.length,
  ).toBeGreaterThan(0);
  return {
    assembly: {
      label: mode,
      catalogVersion: snapshot.match!.catalogVersion,
      selectedCharacterIds: snapshot.match!.questionScope!.selectedCharacterIds,
      remoteContext: {
        roomId: created.roomId,
        matchIndex: String(snapshot.match!.matchIndex),
      },
    },
    roster,
  };
}

async function leaveRoom(
  request: APIRequestContext,
  credential: RoomCredential,
): Promise<void> {
  const response = await request.post(
    `${API_BASE_URL}/api/rooms/${credential.roomId}/leave`,
    {
      headers: { Authorization: `Bearer guest:${credential.guestToken}` },
    },
  );
  expect([204, 404, 409]).toContain(response.status());
}

async function expectLocalRemoteParity(
  request: APIRequestContext,
  index: CatalogSearchIndex,
  assembly: SearchAssembly,
): Promise<void> {
  for (const searchCase of [
    {
      q: "",
      sort: "appearance" as const,
      direction: "asc" as const,
      offset: 0,
      limit: 50,
    },
    {
      q: "灵梦",
      sort: "name" as const,
      direction: "desc" as const,
      offset: 0,
      limit: 12,
    },
  ]) {
    const params = new URLSearchParams({
      ...assembly.remoteContext,
      q: searchCase.q,
      sort: searchCase.sort,
      direction: searchCase.direction,
      offset: String(searchCase.offset),
      limit: String(searchCase.limit),
    });
    const remoteResponse = await request.get(
      `${API_BASE_URL}/api/characters/search?${params}`,
    );
    expect(remoteResponse.status(), `${assembly.label} remote search`).toBe(
      200,
    );
    const remote = (await remoteResponse.json()) as {
      results: Array<{ id: string }>;
      total: number;
    };
    const local = searchCharacters(index, {
      query: searchCase.q,
      allowedIds: assembly.selectedCharacterIds,
      sortBy: searchCase.sort,
      direction: searchCase.direction,
      offset: searchCase.offset,
      limit: searchCase.limit,
    });
    expect(
      local.results.map((entry) => entry.id),
      `${assembly.label} ordered IDs for q=${JSON.stringify(searchCase.q)}`,
    ).toEqual(remote.results.map((entry) => entry.id));
    expect(
      local.total,
      `${assembly.label} total for q=${JSON.stringify(searchCase.q)}`,
    ).toBe(remote.total);
  }
}

test.describe("HSO-007 integration gate", () => {
  test("matches Go ID order and total in catalog, single, race and relay assemblies", async ({
    request,
  }) => {
    test.skip(
      !ALLOW_WRITES,
      "four-entry parity requires HSO007_ALLOW_WRITES=1 on a disposable database",
    );
    const catalogVersion = await expectLocalPrimary(request);
    const indexResponse = await request.get(
      `${API_BASE_URL}/api/catalog/${encodeURIComponent(catalogVersion)}/search-index/1`,
    );
    expect(indexResponse.status()).toBe(200);
    const index = (await indexResponse.json()) as CatalogSearchIndex;
    const resolveResponse = await request.post(
      `${API_BASE_URL}/api/puzzles/random/resolve`,
      { data: { idempotencyKey: crypto.randomUUID() } },
    );
    expect(resolveResponse.status()).toBe(200);
    const resolved = (await resolveResponse.json()) as {
      session: {
        id: string;
        catalogVersion?: string;
        questionScope?: { selectedCharacterIds: string[] };
      };
    };
    expect(resolved.session.catalogVersion).toBe(catalogVersion);
    expect(
      resolved.session.questionScope?.selectedCharacterIds.length,
    ).toBeGreaterThan(0);

    const rooms: RoomCredential[][] = [];
    try {
      const race = await createMultiplayerAssembly(request, "race");
      rooms.push(race.roster);
      const relay = await createMultiplayerAssembly(request, "relay");
      rooms.push(relay.roster);
      const assemblies: SearchAssembly[] = [
        {
          label: "catalog",
          catalogVersion,
          remoteContext: { catalogVersion },
        },
        {
          label: "single",
          catalogVersion: resolved.session.catalogVersion!,
          selectedCharacterIds:
            resolved.session.questionScope!.selectedCharacterIds,
          remoteContext: { sessionId: resolved.session.id },
        },
        race.assembly,
        relay.assembly,
      ];
      for (const assembly of assemblies) {
        expect(assembly.catalogVersion).toBe(catalogVersion);
        await expectLocalRemoteParity(request, index, assembly);
      }
    } finally {
      const cleanup = await request.post(
        `${API_BASE_URL}/api/sessions/${encodeURIComponent(resolved.session.id)}/forfeit`,
      );
      expect(cleanup.status()).toBe(200);
      for (const roster of rooms) {
        for (const credential of roster) await leaveRoom(request, credential);
      }
    }
  });

  test("keeps index versions, immutable caching, ETag and compressed budget bounded", async ({
    request,
  }) => {
    const version = await currentCatalogVersion(request);
    const response = await request.get(
      `${API_BASE_URL}/api/catalog/${encodeURIComponent(version)}/search-index/1`,
      { headers: { "Accept-Encoding": "gzip" } },
    );
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(response.headers().etag).toBeTruthy();
    const body = await response.body();
    const index = JSON.parse(body.toString("utf8")) as {
      catalogVersion?: string;
      indexSchemaVersion?: number;
      entries?: unknown[];
    };
    expect(index.catalogVersion).toBe(version);
    expect(index.indexSchemaVersion).toBe(1);
    expect(index.entries?.length).toBeGreaterThan(0);
    expect(gzipSync(body).byteLength).toBeLessThanOrEqual(
      INDEX_GZIP_BUDGET_BYTES,
    );

    const conditional = await request.get(
      `${API_BASE_URL}/api/catalog/${encodeURIComponent(version)}/search-index/1`,
      { headers: { "If-None-Match": response.headers().etag } },
    );
    expect(conditional.status()).toBe(304);
    expect(conditional.headers()["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(await conditional.body()).toHaveLength(0);
  });

  test("records cold index, hot browser cache and remote connection latency", async ({
    page,
    request,
  }) => {
    const catalogVersion = await expectLocalPrimary(request);
    const indexPath = `/api/catalog/${encodeURIComponent(catalogVersion)}/search-index/1`;
    const firstIndex = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith(indexPath),
    );
    await page.goto("/search");
    expect((await firstIndex).status()).toBe(200);
    const coldEntry = await page.evaluate((path) => {
      const entries = performance
        .getEntriesByType("resource")
        .filter((entry) =>
          new URL(entry.name).pathname.endsWith(path),
        ) as PerformanceResourceTiming[];
      const entry = entries.at(-1);
      return entry
        ? {
            duration: entry.duration,
            transferSize: entry.transferSize,
            encodedBodySize: entry.encodedBodySize,
          }
        : null;
    }, indexPath);
    expect(coldEntry).not.toBeNull();

    const cachedIndex = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith(indexPath),
    );
    await page.reload();
    expect((await cachedIndex).status()).toBe(200);
    const hotEntry = await page.evaluate((path) => {
      const entries = performance
        .getEntriesByType("resource")
        .filter((entry) =>
          new URL(entry.name).pathname.endsWith(path),
        ) as PerformanceResourceTiming[];
      const entry = entries.at(-1);
      return entry
        ? {
            duration: entry.duration,
            transferSize: entry.transferSize,
            encodedBodySize: entry.encodedBodySize,
          }
        : null;
    }, indexPath);
    expect(hotEntry).not.toBeNull();
    expect(hotEntry!.transferSize).toBe(0);

    for (let warmup = 0; warmup < 5; warmup += 1) {
      const response = await request.get(
        `${API_BASE_URL}/api/characters/search?catalogVersion=${encodeURIComponent(catalogVersion)}&q=%E7%81%B5%E6%A2%A6&sort=appearance&direction=asc&limit=12`,
      );
      expect(response.status()).toBe(200);
    }
    const remoteSamples: number[] = [];
    for (let sample = 0; sample < 30; sample += 1) {
      const startedAt = performance.now();
      const response = await request.get(
        `${API_BASE_URL}/api/characters/search?catalogVersion=${encodeURIComponent(catalogVersion)}&q=%E7%81%B5%E6%A2%A6&sort=appearance&direction=asc&limit=12`,
      );
      expect(response.status()).toBe(200);
      remoteSamples.push(performance.now() - startedAt);
    }
    remoteSamples.sort((left, right) => left - right);
    const remoteP95 = remoteSamples[Math.ceil(remoteSamples.length * 0.95) - 1];
    console.log(
      `[HSO-007] coldIndexMs=${coldEntry!.duration.toFixed(2)} coldTransfer=${coldEntry!.transferSize} hotIndexMs=${hotEntry!.duration.toFixed(2)} hotTransfer=${hotEntry!.transferSize} remoteHotP95Ms=${remoteP95.toFixed(2)} samples=${remoteSamples.length}`,
    );
  });

  test("does not block single-game rendering while the index prefetch is pending", async ({
    page,
    request,
  }) => {
    test.skip(
      !ALLOW_WRITES,
      "single-game prefetch integration requires a disposable database",
    );
    await expectLocalPrimary(request);
    const storageKey = "touhouflandre:random-session";
    let releaseIndex: (() => void) | undefined;
    let markIndexStarted: (() => void) | undefined;
    const indexStarted = new Promise<void>((resolve) => {
      markIndexStarted = resolve;
    });
    const indexGate = new Promise<void>((resolve) => {
      releaseIndex = resolve;
    });
    await page.addInitScript(() => {
      const state = globalThis as typeof globalThis & {
        __hso007LongTasks?: number[];
      };
      state.__hso007LongTasks = [];
      new PerformanceObserver((list) => {
        state.__hso007LongTasks!.push(
          ...list.getEntries().map((entry) => entry.duration),
        );
      }).observe({ type: "longtask", buffered: true });
    });
    await page.route("**/api/catalog/*/search-index/*", async (route) => {
      markIndexStarted!();
      await indexGate;
      await route.continue();
    });
    await page.addInitScript((key) => localStorage.removeItem(key), storageKey);
    let browserOffline = false;

    try {
      await page.goto("/single/random");
      await indexStarted;
      await expect(
        page.getByRole("region", { name: "TouhouFlandre 游戏区域" }),
      ).toBeVisible();
      await expect(page.getByLabel("搜索东方角色")).toBeEnabled();
      await page.evaluate(() => {
        (
          globalThis as typeof globalThis & { __hso007LongTasks?: number[] }
        ).__hso007LongTasks = [];
      });
      const indexResponse = page.waitForResponse((response) =>
        response.url().includes("/search-index/"),
      );
      releaseIndex!();
      expect((await indexResponse).status()).toBe(200);
      await page.waitForTimeout(100);
      const longTasks = await page.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              __hso007LongTasks?: number[];
            }
          ).__hso007LongTasks ?? [],
      );
      expect(longTasks).toEqual([]);

      const input = page.getByLabel("搜索东方角色");
      await input.fill("灵梦");
      const suggestion = page.locator(".suggestion", { hasText: "博丽灵梦" });
      await expect(suggestion).toBeVisible();
      await suggestion.click();
      await page.context().setOffline(true);
      browserOffline = true;
      await page.getByRole("button", { name: "提交猜测" }).click();
      await expect(page.locator(".message.error")).toContainText(
        /fetch|网络|请求|失败/i,
      );
      await page.context().setOffline(false);
      browserOffline = false;
    } finally {
      if (browserOffline) await page.context().setOffline(false);
      releaseIndex?.();
      const sessionId = await page.evaluate((key) => {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        try {
          const parsed = JSON.parse(raw) as { id?: unknown };
          return typeof parsed.id === "string" ? parsed.id : null;
        } catch {
          return null;
        }
      }, storageKey);
      if (sessionId) {
        const cleanup = await request.post(
          `${API_BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}/forfeit`,
        );
        expect(cleanup.status()).toBe(200);
      }
    }
  });

  test("falls back on repeated index packet loss and recovers through one probe", async ({
    page,
    request,
  }) => {
    await expectLocalPrimary(request);
    await page.addInitScript(() => {
      const clock = globalThis as typeof globalThis & {
        __hso007ClockOffset?: number;
      };
      const startedAt = Date.now();
      clock.__hso007ClockOffset = 0;
      Date.now = () => startedAt + (clock.__hso007ClockOffset ?? 0);
    });
    let indexAttempts = 0;
    let remoteRequests = 0;
    await page.route("**/api/catalog/*/search-index/*", async (route) => {
      indexAttempts += 1;
      if (indexAttempts <= 2) {
        await route.abort("connectionfailed");
        return;
      }
      await route.continue();
    });
    page.on("request", (requestEvent) => {
      if (new URL(requestEvent.url()).pathname === "/api/characters/search")
        remoteRequests += 1;
    });

    await page.goto("/search");
    const input = page.getByLabel("搜索角色");
    await input.fill("灵梦");
    await expect(page.getByText("博丽灵梦")).toBeVisible();
    expect(indexAttempts).toBe(1);
    expect(remoteRequests).toBeGreaterThan(0);

    await page.evaluate(() => {
      (
        globalThis as typeof globalThis & { __hso007ClockOffset?: number }
      ).__hso007ClockOffset = 6_000;
    });
    const remoteBeforeSecondFailure = remoteRequests;
    await input.fill("魔理沙");
    await expect.poll(() => indexAttempts).toBe(2);
    await expect
      .poll(() => remoteRequests)
      .toBeGreaterThan(remoteBeforeSecondFailure);
    await expect(page.getByText("雾雨魔理沙")).toBeVisible();
    const remoteAfterSecondFailure = remoteRequests;

    await page.evaluate(() => {
      (
        globalThis as typeof globalThis & { __hso007ClockOffset?: number }
      ).__hso007ClockOffset = 42_000;
    });
    await input.fill("咲夜");
    await expect.poll(() => indexAttempts).toBe(3);
    await expect(page.getByText("十六夜咲夜")).toBeVisible();
    expect(remoteRequests).toBe(remoteAfterSecondFailure);
  });

  test("limits offline search to the validated same-page five minute window", async ({
    page,
    request,
  }) => {
    await expectLocalPrimary(request);
    await page.addInitScript(() => {
      const clock = globalThis as typeof globalThis & {
        __hso007ClockOffset?: number;
      };
      const startedAt = Date.now();
      clock.__hso007ClockOffset = 0;
      Date.now = () => startedAt + (clock.__hso007ClockOffset ?? 0);
    });
    let remoteRequests = 0;
    page.on("request", (requestEvent) => {
      if (new URL(requestEvent.url()).pathname === "/api/characters/search")
        remoteRequests += 1;
    });
    await page.goto("/search");
    const input = page.getByLabel("搜索角色");
    await input.fill("灵梦");
    await expect(page.getByText("博丽灵梦")).toBeVisible();
    remoteRequests = 0;

    await page.context().setOffline(true);
    await page.evaluate(() => {
      (
        globalThis as typeof globalThis & { __hso007ClockOffset?: number }
      ).__hso007ClockOffset = 60_000;
    });
    await input.fill("魔理沙");
    await expect(page.getByText("博丽灵梦")).toHaveCount(0);
    await expect(page.getByText("雾雨魔理沙")).toBeVisible();
    expect(remoteRequests).toBe(0);

    await page.evaluate(() => {
      (
        globalThis as typeof globalThis & { __hso007ClockOffset?: number }
      ).__hso007ClockOffset = 300_001;
    });
    await input.fill("咲夜");
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("button", { name: "重新加载" })).toBeVisible();
    expect(remoteRequests).toBeGreaterThan(0);

    await page.context().setOffline(false);
    await page.getByRole("button", { name: "重新加载" }).click();
    await expect(page.getByText("十六夜咲夜")).toBeVisible();

    await page.route("**/api/catalog/search-policy", (route) =>
      route.abort("connectionfailed"),
    );
    await page.route("**/api/characters/search**", (route) =>
      route.abort("connectionfailed"),
    );
    await page.reload();
    await page.getByLabel("搜索角色").fill("灵梦");
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("button", { name: "重新加载" })).toBeVisible();
  });

  test("uses local search for the catalog after index readiness", async ({
    page,
    request,
  }) => {
    await expectLocalPrimary(request);
    const searchRequests: string[] = [];
    let indexReady: Promise<void>;
    indexReady = new Promise((resolve) => {
      page.on("response", (response) => {
        const url = new URL(response.url());
        if (
          url.pathname.includes("/search-index/") &&
          response.status() === 200
        ) {
          resolve();
        }
      });
      page.on("request", (requestEvent) => {
        const url = new URL(requestEvent.url());
        if (url.pathname === "/api/characters/search") {
          searchRequests.push(url.toString());
        }
      });
    });

    await page.goto("/search");
    await indexReady;
    await expect(page.getByLabel("搜索角色")).toBeEnabled();
    await page.waitForTimeout(100);
    searchRequests.length = 0;

    const input = page.getByLabel("搜索角色");
    await input.fill("灵梦");
    await expect(page.getByText("博丽灵梦")).toBeVisible();
    expect(searchRequests).toEqual([]);
  });

  for (const mode of ["random", "daily"] as const) {
    test(`keeps the ${mode} resolve path to one main request and local input`, async ({
      page,
      request,
    }) => {
      test.skip(
        !ALLOW_WRITES,
        "single-game integration requires HSO007_ALLOW_WRITES=1 on a disposable database",
      );
      await expectLocalPrimary(request);
      const storageKey = `touhouflandre:${mode}-session`;
      const resolvePath = `/api/puzzles/${mode}/resolve`;
      const searchRequests: string[] = [];
      const resolveRequests: string[] = [];
      const apiRequests: string[] = [];
      const indexReady = new Promise<void>((resolve) => {
        page.on("response", (response) => {
          const url = new URL(response.url());
          if (
            url.pathname.includes("/search-index/") &&
            response.status() === 200
          ) {
            resolve();
          }
        });
        page.on("request", (requestEvent) => {
          const url = new URL(requestEvent.url());
          if (url.pathname.startsWith("/api/")) apiRequests.push(url.pathname);
          if (url.pathname === "/api/characters/search") {
            searchRequests.push(url.toString());
          }
          if (url.pathname === resolvePath) {
            resolveRequests.push(url.toString());
          }
        });
      });

      await page.addInitScript((key) => {
        localStorage.removeItem(key);
      }, storageKey);
      try {
        const startedAt = performance.now();
        await page.goto(`/single/${mode}`);
        await expect(page.getByLabel("搜索东方角色")).toBeEnabled();
        const readyMs = performance.now() - startedAt;
        await indexReady;
        await page.waitForTimeout(100);
        searchRequests.length = 0;

        const input = page.getByLabel("搜索东方角色");
        await input.fill("灵梦");
        await expect(page.locator(".suggestion").first()).toContainText(
          "博丽灵梦",
        );
        expect(searchRequests).toEqual([]);
        expect(resolveRequests).toHaveLength(1);
        console.log(
          `[HSO-007] ${mode} readyMs=${readyMs.toFixed(2)} apiRequestCount=${apiRequests.length} paths=${apiRequests.join(",")}`,
        );
      } finally {
        const sessionId = await page.evaluate((key) => {
          const raw = localStorage.getItem(key);
          if (!raw) return null;
          try {
            const parsed = JSON.parse(raw) as { id?: unknown };
            return typeof parsed.id === "string" ? parsed.id : null;
          } catch {
            return null;
          }
        }, storageKey);
        if (sessionId) {
          const cleanup = await request.post(
            `${API_BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}/forfeit`,
          );
          expect(cleanup.status()).toBe(200);
        }
      }
    });
  }

  test("keeps new Web search usable against a legacy API binary", async ({
    page,
    request,
  }) => {
    test.skip(
      !EXPECT_LEGACY_API,
      "legacy compatibility requires an API without search-policy and index routes",
    );
    const policy = await request.get(
      `${API_BASE_URL}/api/catalog/search-policy`,
    );
    expect([404, 405]).toContain(policy.status());

    const remoteRequests: Array<{ url: string; fallbackReason?: string }> = [];
    page.on("request", (requestEvent) => {
      const url = new URL(requestEvent.url());
      if (url.pathname !== "/api/characters/search") return;
      remoteRequests.push({
        url: url.toString(),
        fallbackReason:
          requestEvent.headers()["x-character-search-fallback-reason"],
      });
    });

    await page.goto("/search");
    const input = page.getByLabel("搜索角色");
    await expect(input).toBeEnabled();
    await input.fill("灵梦");
    await expect(page.getByText("博丽灵梦")).toBeVisible();
    expect(remoteRequests.length).toBeGreaterThanOrEqual(1);
    expect(
      remoteRequests.every(
        (requestEntry) => requestEntry.fallbackReason === undefined,
      ),
    ).toBe(true);
  });

  test("keeps the legacy single-player flow usable across binary versions", async ({
    page,
    request,
  }) => {
    test.skip(
      !ALLOW_WRITES || (!EXPECT_LEGACY_API && !EXPECT_LEGACY_WEB),
      "binary compatibility requires a legacy Web or API and a disposable database",
    );
    const storageKey = "touhouflandre:random-session";
    const resolveStatuses: number[] = [];
    const legacyCreateRequests: string[] = [];
    const catalogFullRequests: string[] = [];
    page.on("response", (response) => {
      if (new URL(response.url()).pathname === "/api/puzzles/random/resolve") {
        resolveStatuses.push(response.status());
      }
    });
    page.on("request", (requestEvent) => {
      const pathname = new URL(requestEvent.url()).pathname;
      if (pathname === "/api/puzzles/random") {
        legacyCreateRequests.push(requestEvent.url());
      }
      if (pathname === "/api/catalog/full") {
        catalogFullRequests.push(requestEvent.url());
      }
    });
    await page.addInitScript((key) => localStorage.removeItem(key), storageKey);

    try {
      await page.goto("/single/random");
      await expect(page.locator(".status-strip")).toContainText(/0\/8/);
      await expect(page.getByLabel("搜索东方角色")).toBeEnabled();
      expect(legacyCreateRequests).toHaveLength(1);
      expect(catalogFullRequests).toHaveLength(1);
      if (EXPECT_LEGACY_WEB) {
        expect(resolveStatuses).toEqual([]);
      } else {
        expect(resolveStatuses).toEqual([404]);
      }
    } finally {
      const sessionId = await page.evaluate((key) => {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        try {
          const parsed = JSON.parse(raw) as { id?: unknown };
          return typeof parsed.id === "string" ? parsed.id : null;
        } catch {
          return null;
        }
      }, storageKey);
      if (sessionId) {
        const cleanup = await request.post(
          `${API_BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}/forfeit`,
        );
        expect(cleanup.status()).toBe(200);
      }
    }
  });
});
