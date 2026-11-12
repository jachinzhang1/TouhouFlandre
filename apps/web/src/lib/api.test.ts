import { afterEach, describe, expect, it, vi } from "vitest";

async function loadRoomWsUrl(apiBaseUrl: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", apiBaseUrl);
  const mod = await import("./api");
  return mod.roomWsUrl;
}

describe("roomWsUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses ws protocol for same-origin API proxy", async () => {
    const roomWsUrl = await loadRoomWsUrl("");

    expect(roomWsUrl("room-1")).toBe(
      `${window.location.origin.replace(/^http/, "ws")}/api/rooms/room-1/ws`,
    );
  });

  it("preserves the configured local API hostname", async () => {
    const roomWsUrl = await loadRoomWsUrl("http://localhost:4000");

    expect(roomWsUrl("room-1")).toBe("ws://localhost:4000/api/rooms/room-1/ws");
  });

  it("uses wss protocol for direct HTTPS API", async () => {
    const roomWsUrl = await loadRoomWsUrl("https://api.example.com");

    expect(roomWsUrl("room-1")).toBe(
      "wss://api.example.com/api/rooms/room-1/ws",
    );
  });
});
