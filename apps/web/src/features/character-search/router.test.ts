import type { CatalogSearchIndex } from "@touhouflandre/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CharacterSearchRouter } from "./router";

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

  it("recognizes the exact policy timeout boundary", async () => {
    vi.useFakeTimers();
    const policy = new Promise<never>(() => undefined);
    const remote = vi.fn().mockResolvedValue({ results: [], total: 0 });
    const router = new CharacterSearchRouter({
      policyClient: { get: vi.fn().mockReturnValue(policy) },
      remoteSearch: { search: remote },
    });
    const pending = router.search({ q: "x" }, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(pending).resolves.toEqual({ results: [], total: 0 });
    expect(remote).toHaveBeenCalledWith(
      { q: "x" },
      expect.any(AbortSignal),
      "policy_unavailable",
    );
    router.dispose();
  });
});
