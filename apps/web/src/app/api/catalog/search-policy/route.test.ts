import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("catalog search policy proxy", () => {
  it("forwards no-store policy responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"mode":"remote"}', {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      })),
    );
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain('"mode":"remote"');
    vi.unstubAllGlobals();
  });
});
