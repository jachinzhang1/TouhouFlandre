import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("catalog search index proxy", () => {
  it("forwards the upstream status and immutable headers", async () => {
    const fetchMock = vi.fn(async () =>
      new Response('{"catalogVersion":"v1"}', {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=31536000, immutable",
          ETag: '"etag-v1"',
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://web.test/api/catalog/v1/search-index/1"), {
      params: Promise.resolve({ catalogVersion: "v1", indexSchemaVersion: "1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("etag")).toBe('"etag-v1"');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/catalog/v1/search-index/1"),
      expect.objectContaining({ cache: "no-store" }),
    );
    vi.unstubAllGlobals();
  });

  it("forwards conditional requests to the upstream index", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(null, {
        status: 304,
        headers: {
          "Cache-Control": "public, max-age=31536000, immutable",
          ETag: '"etag-v1"',
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("http://web.test/api/catalog/v1/search-index/1", {
        headers: { "If-None-Match": '"etag-v1"' },
      }),
      { params: Promise.resolve({ catalogVersion: "v1", indexSchemaVersion: "1" }) },
    );

    expect(response.status).toBe(304);
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const [, init] = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0];
    expect(new Headers(init.headers).get("If-None-Match")).toBe('"etag-v1"');
    vi.unstubAllGlobals();
  });

  it("does not cache proxy failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const response = await GET(new Request("http://web.test/api/catalog/v1/search-index/1"), {
      params: Promise.resolve({ catalogVersion: "v1", indexSchemaVersion: "1" }),
    });
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    vi.unstubAllGlobals();
  });
});
