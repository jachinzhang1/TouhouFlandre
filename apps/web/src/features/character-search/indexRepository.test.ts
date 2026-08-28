import { describe, expect, it, vi } from "vitest";
import { CatalogSearchIndexRepository } from "./indexRepository";

const payload = { catalogVersion: "catalog-v1", indexSchemaVersion: 1, entries: [] };
const response = (body: unknown, ok = true, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("CatalogSearchIndexRepository", () => {
  it("deduplicates same-key loads and reuses the validated instance", async () => {
    let resolve: ((value: Response) => void) | undefined;
    const fetcher = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
    const repository = new CatalogSearchIndexRepository({ fetch: fetcher });
    const first = repository.load("catalog-v1");
    const second = repository.load("catalog-v1");
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolve!(response(payload));
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    await repository.load("catalog-v1");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("repairs one bad cached response with cache reload and permits retry after failure", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ ...payload, catalogVersion: "wrong" }))
      .mockResolvedValueOnce(response(payload));
    const repository = new CatalogSearchIndexRepository({ fetch: fetcher });
    await expect(repository.load("catalog-v1", 1, undefined, "r1")).resolves.toEqual(payload);
    expect(fetcher).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({ cache: "reload" }));
  });

  it("repairs malformed JSON once per policy revision", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("not-json"))
      .mockResolvedValueOnce(new Response("still-not-json"));
    const repository = new CatalogSearchIndexRepository({ fetch: fetcher });
    await expect(repository.load("catalog-v1", 1, undefined, "r1")).rejects.toThrow();
    await expect(repository.load("catalog-v1", 1, undefined, "r1")).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({ cache: "reload" }));
  });

  it("does not cancel a shared request when one consumer aborts", async () => {
    let resolve: ((value: Response) => void) | undefined;
    const fetcher = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
    const repository = new CatalogSearchIndexRepository({ fetch: fetcher });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = repository.load("catalog-v1", 1, firstController.signal);
    const second = repository.load("catalog-v1", 1, secondController.signal);
    firstController.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolve!(response(payload));
    await expect(second).resolves.toEqual(payload);
  });
});
