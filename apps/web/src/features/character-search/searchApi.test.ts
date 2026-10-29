import { afterEach, describe, expect, it, vi } from "vitest";

async function loadSearchApi() {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.example.test");
  return import("./searchApi");
}

const okResponse = () =>
  new Response(JSON.stringify({ results: [], total: 0 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

function useRequestWithoutJsdomSignal() {
  const nativeRequest = globalThis.Request;
  class RequestWithoutJsdomSignal extends nativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(input, { ...init, signal: undefined });
    }
  }
  vi.stubGlobal("Request", RequestWithoutJsdomSignal);
}

describe("search API adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("retries once without the fallback header after a CORS preflight TypeError", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("CORS preflight rejected"))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    useRequestWithoutJsdomSignal();
    const { defaultRemoteSearchAdapter } = await loadSearchApi();

    await expect(
      defaultRemoteSearchAdapter.search(
        {
          q: "灵梦",
          sessionId: "session-1",
          catalogVersion: "catalog-v1",
          workIds: "th06_eosd",
          limit: 10,
        },
        new AbortController().signal,
        "index_transient",
      ),
    ).resolves.toEqual({ results: [], total: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = fetchMock.mock.calls[0]?.[0] as Request;
    const second = fetchMock.mock.calls[1]?.[0] as Request;
    expect(first.url).toBe(second.url);
    expect(first.headers.get("X-Character-Search-Fallback-Reason")).toBe(
      "index_transient",
    );
    expect(second.headers.get("X-Character-Search-Fallback-Reason")).toBeNull();
  });

  it("keeps fallback reasons out of query semantics", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    useRequestWithoutJsdomSignal();
    const { defaultRemoteSearchAdapter } = await loadSearchApi();

    await defaultRemoteSearchAdapter.search(
      { q: "secret", roomId: "room-1", matchIndex: 2 },
      new AbortController().signal,
      "engine_error",
    );
    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(new URL(request.url).searchParams.get("q")).toBe("secret");
    expect(new URL(request.url).searchParams.get("roomId")).toBe("room-1");
    expect(request.headers.get("X-Character-Search-Fallback-Reason")).toBe(
      "engine_error",
    );
  });
});
