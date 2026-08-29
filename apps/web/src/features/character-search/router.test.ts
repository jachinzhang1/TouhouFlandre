import type { CatalogSearchIndex } from "@touhouflandre/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CharacterSearchRouter } from "./router";
import { SearchIndexHttpError } from "./indexRepository";

const index: CatalogSearchIndex = {
  catalogVersion: "catalog-v1",
  indexSchemaVersion: 1,
  entries: [
    {
      id: "reimu",
      name: "Reimu",
      subtitle: "Hakurei",
      initials: "R",
      avatarUrl: "",
      appearanceOrder: 1,
      workId: "th06_eosd",
      firstAppearance: { workTitle: "紅魔郷", releaseYear: 2002 },
      species: ["human"],
      locations: ["shrine"],
      affiliations: ["shrine"],
      hairColors: ["black"],
      searchTerms: ["reimu", "霊夢"],
      nameSortKey: "reimu",
    },
  ],
};

const localPolicy = {
  mode: "local-primary" as const,
  indexSchemaVersion: 1,
  revision: "v1",
  gameScopeMode: "strict" as const,
  revalidateAfterSeconds: 60,
};

describe("CharacterSearchRouter", () => {
  beforeEach(() => vi.useRealTimers());

  it("uses remote on cold-start policy failure", async () => {
    const remote = vi.fn().mockResolvedValue({ results: [], total: 0 });
    const router = new CharacterSearchRouter({
      policyClient: { get: vi.fn().mockRejectedValue(new Error("offline")) },
      remoteSearch: { search: remote },
    });
    await router.search({ q: "reimu" }, new AbortController().signal);
    expect(remote).toHaveBeenCalledWith(
      { q: "reimu" },
      expect.any(AbortSignal),
      "policy_unavailable",
    );
    router.dispose();
  });

  it("omits fallback reason when the policy route is missing", async () => {
    const remote = vi.fn().mockResolvedValue({ results: [], total: 0 });
    const router = new CharacterSearchRouter({
      policyClient: { get: vi.fn().mockRejectedValue({ status: 404 }) },
      remoteSearch: { search: remote },
    });
    await router.search({ q: "reimu" }, new AbortController().signal);
    expect(remote.mock.calls[0]?.[2]).toBeUndefined();
    router.dispose();
  });

  it("searches local index without remote when context is complete", async () => {
    const remote = vi.fn();
    const load = vi.fn().mockResolvedValue(index);
    const router = new CharacterSearchRouter({
      policyClient: { get: vi.fn().mockResolvedValue(localPolicy) },
      indexRepository: { load } as never,
      remoteSearch: { search: remote },
    });
    const result = await router.search(
      { q: "reim", catalogVersion: "catalog-v1", contextKind: "catalog" },
      new AbortController().signal,
    );
    expect(result.total).toBe(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(remote).not.toHaveBeenCalled();
    router.dispose();
  });

  it("prefetches a complete local game index without remote search", async () => {
    const remote = vi.fn();
    const load = vi.fn().mockResolvedValue(index);
    const router = new CharacterSearchRouter({
      policyClient: { get: vi.fn().mockResolvedValue(localPolicy) },
      indexRepository: { load } as never,
      remoteSearch: { search: remote },
    });

    await router.prefetch({
      q: "",
      catalogVersion: "catalog-v1",
      contextKind: "single-session",
      sessionId: "session-1",
      selectedCharacterIds: ["reimu"],
    });

    expect(load).toHaveBeenCalledTimes(1);
    expect(remote).not.toHaveBeenCalled();
    router.dispose();
  });

  it("does not prefetch when policy is remote or scope is incomplete", async () => {
    const remotePolicyLoad = vi.fn();
    const strictLoad = vi.fn();
    const remoteRouter = new CharacterSearchRouter({
      policyClient: {
        get: vi.fn().mockResolvedValue({ ...localPolicy, mode: "remote" }),
      },
      indexRepository: { load: remotePolicyLoad } as never,
    });
    await remoteRouter.prefetch({
      q: "",
      catalogVersion: "catalog-v1",
      contextKind: "catalog",
    });
    remoteRouter.dispose();

    const strictRouter = new CharacterSearchRouter({
      policyClient: { get: vi.fn().mockResolvedValue(localPolicy) },
      indexRepository: { load: strictLoad } as never,
    });
    await strictRouter.prefetch({
      q: "",
      catalogVersion: "catalog-v1",
      contextKind: "single-session",
      selectedCharacterIds: [],
    });
    strictRouter.dispose();

    expect(remotePolicyLoad).not.toHaveBeenCalled();
    expect(strictLoad).not.toHaveBeenCalled();
  });

  it("records prefetch failures so the first search uses the same fallback circuit", async () => {
    const remote = vi.fn().mockResolvedValue({ results: [], total: 0 });
    const load = vi.fn().mockRejectedValue(new Error("network"));
    const router = new CharacterSearchRouter({
      policyClient: { get: vi.fn().mockResolvedValue(localPolicy) },
      indexRepository: { load } as never,
      remoteSearch: { search: remote },
      jitter: (value) => value,
    });

    await router.prefetch({
      q: "",
      catalogVersion: "catalog-v1",
      contextKind: "single-session",
      sessionId: "session-1",
      selectedCharacterIds: ["reimu"],
    });
    await router.search(
      {
        q: "reimu",
        catalogVersion: "catalog-v1",
        contextKind: "single-session",
        sessionId: "session-1",
        selectedCharacterIds: ["reimu"],
      },
      new AbortController().signal,
    );

    expect(load).toHaveBeenCalledTimes(1);
    expect(remote).toHaveBeenCalledWith(
      expect.objectContaining({ q: "reimu", sessionId: "session-1" }),
      expect.any(AbortSignal),
      "index_transient",
    );
    router.dispose();
  });

  it("fails closed for strict game context with an empty scope", async () => {
    const remote = vi.fn().mockResolvedValue({ results: [], total: 0 });
    const router = new CharacterSearchRouter({
      policyClient: { get: vi.fn().mockResolvedValue(localPolicy) },
      indexRepository: { load: vi.fn() } as never,
      remoteSearch: { search: remote },
    });
    await router.search(
      {
        q: "reimu",
        catalogVersion: "catalog-v1",
        contextKind: "single-session",
        selectedCharacterIds: [],
      },
      new AbortController().signal,
    );
    expect(remote).toHaveBeenCalledWith(
      expect.objectContaining({ q: "reimu" }),
      expect.any(AbortSignal),
      "context_incomplete",
    );
    router.dispose();
  });

  it("forces remote for full game scope", async () => {
    const remote = vi.fn().mockResolvedValue({ results: [], total: 0 });
    const router = new CharacterSearchRouter({
      policyClient: {
        get: vi
          .fn()
          .mockResolvedValue({ ...localPolicy, gameScopeMode: "full" }),
      },
      indexRepository: { load: vi.fn() } as never,
      remoteSearch: { search: remote },
    });
    await router.search(
      {
        q: "reimu",
        catalogVersion: "catalog-v1",
        contextKind: "multiplayer-match",
        selectedCharacterIds: ["reimu"],
      },
      new AbortController().signal,
    );
    expect(remote).toHaveBeenCalledWith(
      expect.objectContaining({ q: "reimu" }),
      expect.any(AbortSignal),
      "context_incomplete",
    );
    router.dispose();
  });

  it("falls back once and records transient index backoff", async () => {
    const remote = vi.fn().mockResolvedValue({ results: [], total: 0 });
    const router = new CharacterSearchRouter({
      policyClient: { get: vi.fn().mockResolvedValue(localPolicy) },
      indexRepository: {
        load: vi.fn().mockRejectedValue(new Error("network")),
      } as never,
      remoteSearch: { search: remote },
      jitter: (value) => value,
    });
    await router.search(
      { q: "reimu", catalogVersion: "catalog-v1", contextKind: "catalog" },
      new AbortController().signal,
    );
    await router.search(
      { q: "reimu", catalogVersion: "catalog-v1", contextKind: "catalog" },
      new AbortController().signal,
    );
    expect(remote).toHaveBeenCalledTimes(2);
    expect(remote).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.any(AbortSignal),
      "index_transient",
    );
    router.dispose();
  });

  it("classifies local engine failures as structural engine errors", async () => {
    const remote = vi.fn().mockResolvedValue({ results: [], total: 0 });
    const load = vi.fn().mockResolvedValue(index);
    const router = new CharacterSearchRouter({
      policyClient: { get: vi.fn().mockResolvedValue(localPolicy) },
      indexRepository: { load } as never,
      localSearch: vi.fn(() => {
        throw new Error("engine exploded");
      }),
      remoteSearch: { search: remote },
    });

    await router.search(
      { q: "reimu", catalogVersion: "catalog-v1", contextKind: "catalog" },
      new AbortController().signal,
    );
    await router.search(
      { q: "reimu", catalogVersion: "catalog-v1", contextKind: "catalog" },
      new AbortController().signal,
    );

    expect(load).toHaveBeenCalledTimes(1);
    expect(remote).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.any(AbortSignal),
      "engine_error",
    );
    expect(remote).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.any(AbortSignal),
      "engine_error",
    );
    router.dispose();
  });

  it("omits the fallback header for an old index route", async () => {
    const remote = vi.fn().mockResolvedValue({ results: [], total: 0 });
    const router = new CharacterSearchRouter({
      policyClient: { get: vi.fn().mockResolvedValue(localPolicy) },
      indexRepository: {
        load: vi
          .fn()
          .mockRejectedValue(
            new SearchIndexHttpError(
              404,
              undefined,
              "COMPATIBILITY_ROUTE_MISSING",
            ),
          ),
      } as never,
      remoteSearch: { search: remote },
    });

    await router.search(
      { q: "reimu", catalogVersion: "catalog-v1", contextKind: "catalog" },
      new AbortController().signal,
    );

    expect(remote).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(AbortSignal),
      undefined,
    );
    router.dispose();
  });

  it.each([
    ["below", 2_999, false],
    ["equal", 3_000, true],
    ["above", 3_001, true],
  ] as const)(
    "applies the policy timeout %s the 3 second boundary",
    async (_label, elapsed, timedOut) => {
      vi.useFakeTimers();
      type RemotePolicy = Omit<typeof localPolicy, "mode"> & {
        mode: "remote";
      };
      let resolvePolicy: ((value: RemotePolicy) => void) | undefined;
      const policy = new Promise<RemotePolicy>((resolve) => {
        resolvePolicy = resolve;
      });
      const remote = vi.fn().mockResolvedValue({ results: [], total: 0 });
      const router = new CharacterSearchRouter({
        policyClient: { get: vi.fn().mockReturnValue(policy) },
        remoteSearch: { search: remote },
      });
      const pending = router.search({ q: "x" }, new AbortController().signal);

      await vi.advanceTimersByTimeAsync(elapsed);
      if (!timedOut) {
        expect(remote).not.toHaveBeenCalled();
        resolvePolicy!({ ...localPolicy, mode: "remote" });
        await vi.advanceTimersByTimeAsync(0);
      }

      await expect(pending).resolves.toEqual({ results: [], total: 0 });
      expect(remote).toHaveBeenCalledWith(
        { q: "x" },
        expect.any(AbortSignal),
        timedOut ? "policy_unavailable" : "policy_remote",
      );
      router.dispose();
    },
  );

  it("uses last-known-good only while the validated in-memory index is within five minutes", async () => {
    let now = 0;
    const remote = vi.fn().mockResolvedValue({ results: [], total: 0 });
    const policyClient = {
      get: vi
        .fn()
        .mockResolvedValueOnce(localPolicy)
        .mockRejectedValue(new TypeError("offline")),
    };
    const router = new CharacterSearchRouter({
      policyClient,
      indexRepository: { load: vi.fn().mockResolvedValue(index) } as never,
      remoteSearch: { search: remote },
      now: () => now,
    });
    const request = {
      q: "reimu",
      catalogVersion: "catalog-v1",
      contextKind: "catalog" as const,
    };

    await router.search(request, new AbortController().signal);
    now = 300_000;
    await router.search(request, new AbortController().signal);
    expect(remote).not.toHaveBeenCalled();

    now = 300_001;
    await router.search(request, new AbortController().signal);
    expect(remote).toHaveBeenCalledOnce();
    expect(remote).toHaveBeenCalledWith(
      expect.objectContaining({ q: "reimu" }),
      expect.any(AbortSignal),
      "policy_unavailable",
    );
    router.dispose();
  });

  it.each([
    ["below", 4_999, false],
    ["equal", 5_000, true],
    ["above", 5_001, true],
  ] as const)(
    "applies the index timeout %s the 5 second boundary",
    async (_label, elapsed, timedOut) => {
      vi.useFakeTimers();
      let resolveIndex: ((value: CatalogSearchIndex) => void) | undefined;
      const load = vi.fn().mockReturnValue(
        new Promise<CatalogSearchIndex>((resolve) => {
          resolveIndex = resolve;
        }),
      );
      const remote = vi.fn().mockResolvedValue({ results: [], total: 0 });
      const router = new CharacterSearchRouter({
        policyClient: { get: vi.fn().mockResolvedValue(localPolicy) },
        indexRepository: { load } as never,
        remoteSearch: { search: remote },
      });
      const pending = router.search(
        {
          q: "reimu",
          catalogVersion: "catalog-v1",
          contextKind: "catalog",
        },
        new AbortController().signal,
      );

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(elapsed);
      if (!timedOut) {
        expect(remote).not.toHaveBeenCalled();
        resolveIndex!(index);
        await vi.advanceTimersByTimeAsync(0);
      }

      await expect(pending).resolves.toMatchObject({ total: timedOut ? 0 : 1 });
      if (timedOut) {
        expect(remote).toHaveBeenCalledWith(
          expect.objectContaining({ q: "reimu" }),
          expect.any(AbortSignal),
          "index_transient",
        );
      } else {
        expect(remote).not.toHaveBeenCalled();
      }
      router.dispose();
    },
  );

  it("does not open an index circuit when the user cancels", async () => {
    const load = vi
      .fn()
      .mockImplementationOnce((_version, _schema, signal: AbortSignal) => {
        return new Promise<CatalogSearchIndex>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true },
          );
        });
      })
      .mockResolvedValueOnce(index);
    const remote = vi.fn().mockResolvedValue({ results: [], total: 0 });
    const router = new CharacterSearchRouter({
      policyClient: { get: vi.fn().mockResolvedValue(localPolicy) },
      indexRepository: { load } as never,
      remoteSearch: { search: remote },
    });
    const request = {
      q: "reimu",
      catalogVersion: "catalog-v1",
      contextKind: "catalog" as const,
    };
    const controller = new AbortController();
    const cancelled = router.search(request, controller.signal);

    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      router.search(request, new AbortController().signal),
    ).resolves.toMatchObject({ total: 1 });
    expect(load).toHaveBeenCalledTimes(2);
    expect(remote).not.toHaveBeenCalled();
    router.dispose();
  });

  it("recovers a transient index through one probe after every backoff boundary", async () => {
    let now = 0;
    const remote = vi.fn().mockResolvedValue({ results: [], total: 0 });
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("first outage"))
      .mockRejectedValueOnce(new Error("second outage"))
      .mockRejectedValueOnce(new Error("third outage"))
      .mockRejectedValueOnce(new Error("fourth outage"))
      .mockResolvedValue(index);
    const router = new CharacterSearchRouter({
      policyClient: { get: vi.fn().mockResolvedValue(localPolicy) },
      indexRepository: { load } as never,
      remoteSearch: { search: remote },
      jitter: (value) => value,
      now: () => now,
    });
    const request = {
      q: "reimu",
      catalogVersion: "catalog-v1",
      contextKind: "catalog" as const,
    };

    await router.search(request, new AbortController().signal);
    now = 4_999;
    await router.search(request, new AbortController().signal);
    expect(load).toHaveBeenCalledTimes(1);

    now = 5_000;
    await router.search(request, new AbortController().signal);
    now = 34_999;
    await router.search(request, new AbortController().signal);
    expect(load).toHaveBeenCalledTimes(2);

    now = 35_000;
    await router.search(request, new AbortController().signal);
    now = 154_999;
    await router.search(request, new AbortController().signal);
    expect(load).toHaveBeenCalledTimes(3);

    now = 155_000;
    await router.search(request, new AbortController().signal);
    now = 454_999;
    await router.search(request, new AbortController().signal);
    expect(load).toHaveBeenCalledTimes(4);

    now = 455_000;
    const recovered = await router.search(
      request,
      new AbortController().signal,
    );
    expect(recovered.total).toBe(1);
    expect(load).toHaveBeenCalledTimes(5);
    expect(remote).toHaveBeenCalledTimes(8);
    router.dispose();
  });

  it("allows only one explicit retry probe for a structural circuit", async () => {
    let resolveProbe: ((value: CatalogSearchIndex) => void) | undefined;
    const remote = vi.fn().mockResolvedValue({ results: [], total: 0 });
    const load = vi
      .fn()
      .mockRejectedValueOnce(
        new SearchIndexHttpError(404, undefined, "CATALOG_VERSION_NOT_FOUND"),
      )
      .mockReturnValueOnce(
        new Promise<CatalogSearchIndex>((resolve) => {
          resolveProbe = resolve;
        }),
      );
    const router = new CharacterSearchRouter({
      policyClient: { get: vi.fn().mockResolvedValue(localPolicy) },
      indexRepository: { load } as never,
      remoteSearch: { search: remote },
    });
    const request = {
      q: "reimu",
      catalogVersion: "catalog-v1",
      contextKind: "catalog" as const,
    };

    await router.search(request, new AbortController().signal);
    const firstRetry = router.search(
      { ...request, retry: true },
      new AbortController().signal,
    );
    const concurrentRetry = router.search(
      { ...request, retry: true },
      new AbortController().signal,
    );
    await expect(concurrentRetry).resolves.toEqual({ results: [], total: 0 });
    expect(load).toHaveBeenCalledTimes(2);

    resolveProbe!(index);
    await expect(firstRetry).resolves.toMatchObject({ total: 1 });
    expect(remote).toHaveBeenCalledTimes(2);
    router.dispose();
  });

  it("allows only one automatic probe after a transient backoff", async () => {
    let now = 0;
    let resolveProbe: ((value: CatalogSearchIndex) => void) | undefined;
    const remote = vi.fn().mockResolvedValue({ results: [], total: 0 });
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("network outage"))
      .mockReturnValueOnce(
        new Promise<CatalogSearchIndex>((resolve) => {
          resolveProbe = resolve;
        }),
      );
    const router = new CharacterSearchRouter({
      policyClient: { get: vi.fn().mockResolvedValue(localPolicy) },
      indexRepository: { load } as never,
      remoteSearch: { search: remote },
      jitter: (value) => value,
      now: () => now,
    });
    const request = {
      q: "reimu",
      catalogVersion: "catalog-v1",
      contextKind: "catalog" as const,
    };

    await router.search(request, new AbortController().signal);
    now = 5_000;
    const firstProbe = router.search(request, new AbortController().signal);
    const concurrentSearch = router.search(
      request,
      new AbortController().signal,
    );
    await expect(concurrentSearch).resolves.toEqual({ results: [], total: 0 });
    expect(load).toHaveBeenCalledTimes(2);

    resolveProbe!(index);
    await expect(firstProbe).resolves.toMatchObject({ total: 1 });
    expect(remote).toHaveBeenCalledTimes(2);
    router.dispose();
  });

  it("keeps a structural circuit closed until policy revision changes", async () => {
    let now = 0;
    const remote = vi.fn().mockResolvedValue({ results: [], total: 0 });
    const load = vi
      .fn()
      .mockRejectedValueOnce(
        new SearchIndexHttpError(404, undefined, "CATALOG_VERSION_NOT_FOUND"),
      )
      .mockResolvedValue(index);
    const policyClient = {
      get: vi
        .fn()
        .mockResolvedValueOnce(localPolicy)
        .mockResolvedValueOnce(localPolicy)
        .mockResolvedValue({ ...localPolicy, revision: "v2" }),
    };
    const router = new CharacterSearchRouter({
      policyClient,
      indexRepository: { load } as never,
      remoteSearch: { search: remote },
      now: () => now,
    });
    const request = {
      q: "reimu",
      catalogVersion: "catalog-v1",
      contextKind: "catalog" as const,
    };

    await router.search(request, new AbortController().signal);
    now = 60_000;
    await router.search(request, new AbortController().signal);
    expect(load).toHaveBeenCalledTimes(1);

    now = 120_000;
    const recovered = await router.search(
      request,
      new AbortController().signal,
    );
    expect(recovered.total).toBe(1);
    expect(load).toHaveBeenCalledTimes(2);
    router.dispose();
  });

  it("probes a changed index key without reopening the old structural circuit", async () => {
    const remote = vi.fn().mockResolvedValue({ results: [], total: 0 });
    const load = vi
      .fn()
      .mockRejectedValueOnce(
        new SearchIndexHttpError(404, undefined, "CATALOG_VERSION_NOT_FOUND"),
      )
      .mockResolvedValueOnce({ ...index, catalogVersion: "catalog-v2" });
    const router = new CharacterSearchRouter({
      policyClient: { get: vi.fn().mockResolvedValue(localPolicy) },
      indexRepository: { load } as never,
      remoteSearch: { search: remote },
    });

    await router.search(
      { q: "reimu", catalogVersion: "catalog-v1", contextKind: "catalog" },
      new AbortController().signal,
    );
    const recovered = await router.search(
      { q: "reimu", catalogVersion: "catalog-v2", contextKind: "catalog" },
      new AbortController().signal,
    );

    expect(recovered.total).toBe(1);
    expect(load).toHaveBeenCalledTimes(2);
    expect(remote).toHaveBeenCalledTimes(1);
    router.dispose();
  });

  it("scopes a structural circuit to one page lifecycle", async () => {
    const remote = vi.fn().mockResolvedValue({ results: [], total: 0 });
    const load = vi
      .fn()
      .mockRejectedValueOnce(
        new SearchIndexHttpError(404, undefined, "CATALOG_VERSION_NOT_FOUND"),
      )
      .mockResolvedValueOnce(index);
    const request = {
      q: "reimu",
      catalogVersion: "catalog-v1",
      contextKind: "catalog" as const,
    };
    const firstPage = new CharacterSearchRouter({
      policyClient: { get: vi.fn().mockResolvedValue(localPolicy) },
      indexRepository: { load } as never,
      remoteSearch: { search: remote },
    });
    await firstPage.search(request, new AbortController().signal);
    firstPage.dispose();

    const reloadedPage = new CharacterSearchRouter({
      policyClient: { get: vi.fn().mockResolvedValue(localPolicy) },
      indexRepository: { load } as never,
      remoteSearch: { search: remote },
    });
    const recovered = await reloadedPage.search(
      request,
      new AbortController().signal,
    );

    expect(recovered.total).toBe(1);
    expect(load).toHaveBeenCalledTimes(2);
    expect(remote).toHaveBeenCalledTimes(1);
    reloadedPage.dispose();
  });

  it("lets a refreshed remote policy take over an already-open router", async () => {
    let now = 0;
    const remote = vi.fn().mockResolvedValue({ results: [], total: 0 });
    const policyClient = {
      get: vi
        .fn()
        .mockResolvedValueOnce(localPolicy)
        .mockResolvedValue({ ...localPolicy, mode: "remote" }),
    };
    const router = new CharacterSearchRouter({
      policyClient,
      indexRepository: { load: vi.fn().mockResolvedValue(index) } as never,
      remoteSearch: { search: remote },
      now: () => now,
    });
    const request = {
      q: "reimu",
      catalogVersion: "catalog-v1",
      contextKind: "catalog" as const,
    };

    await router.search(request, new AbortController().signal);
    now = 60_000;
    await router.search(request, new AbortController().signal);

    expect(remote).toHaveBeenCalledOnce();
    expect(remote).toHaveBeenCalledWith(
      expect.objectContaining({ q: "reimu" }),
      expect.any(AbortSignal),
      "policy_remote",
    );
    router.dispose();
  });
});
