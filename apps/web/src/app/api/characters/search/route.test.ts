import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("character search proxy", () => {
  it("forwards the optional fallback reason header and upstream status", async () => {
    const fetchMock = vi.fn(async () => new Response('{"results":[],"total":0}', {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(new Request("http://web.test/api/characters/search?q=reimu" , {
      headers: { "X-Character-Search-Fallback-Reason": "index_transient" },
    }));
    expect(response.status).toBe(200);
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit | undefined]>;
    const call = calls[0];
    expect(call).toBeDefined();
    const init = call?.[1] as RequestInit | undefined;
    expect(new Headers(init?.headers).get("X-Character-Search-Fallback-Reason")).toBe("index_transient");
    expect(call?.[0]).toContain("q=reimu");
    vi.unstubAllGlobals();
  });
});
