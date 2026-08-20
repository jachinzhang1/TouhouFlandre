import { expect, test } from "@playwright/test";

const tracks = [
  "/music/tracks/gensoukyoku-bassui/gensoukyoku-bassui-day-06.mp3",
  "/music/tracks/gensoukyoku-bassui/gensoukyoku-bassui-day-12.mp3",
  "/music/tracks/kakunetsuzoushin-hisoutensoku/kakunetsuzoushin-hisoutensoku-track-03.mp3",
] as const;

test.describe("MUS-002 local music assets", () => {
  test("serves every demo MP3 with metadata and byte ranges", async ({
    page,
    request,
  }) => {
    await page.goto("/");

    for (const track of tracks) {
      const response = await request.get(track);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toBe("audio/mpeg");
      expect(Number(response.headers()["content-length"])).toBeGreaterThan(0);

      const rangeResponse = await request.get(track, {
        headers: { Range: "bytes=0-31" },
      });
      expect(rangeResponse.status()).toBe(206);
      expect(rangeResponse.headers()["content-range"]).toMatch(
        /^bytes 0-31\/\d+$/u,
      );

      const metadata = await page.evaluate(
        (src) =>
          new Promise<{ duration: number; readyState: number }>(
            (resolve, reject) => {
              const audio = document.createElement("audio");
              audio.preload = "metadata";
              const timeout = window.setTimeout(
                () => reject(new Error("metadata timeout")),
                10_000,
              );
              audio.addEventListener(
                "loadedmetadata",
                () => {
                  window.clearTimeout(timeout);
                  resolve({
                    duration: audio.duration,
                    readyState: audio.readyState,
                  });
                },
                { once: true },
              );
              audio.addEventListener(
                "error",
                () => {
                  window.clearTimeout(timeout);
                  reject(
                    new Error(`media error ${audio.error?.code ?? "unknown"}`),
                  );
                },
                { once: true },
              );
              audio.src = src;
            },
          ),
        track,
      );
      expect(metadata.duration).toBeGreaterThan(0);
      expect(metadata.readyState).toBeGreaterThanOrEqual(1);
    }
  });
});
