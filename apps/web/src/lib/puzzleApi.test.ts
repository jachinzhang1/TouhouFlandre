import { afterEach, describe, expect, it, vi } from "vitest";

async function loadPuzzleApi() {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.example.test");
  return import("./puzzleApi");
}

const successResponse = () =>
  new Response(
    JSON.stringify({
      puzzleLabel: "随机题",
      resolution: "created",
      session: {
        id: "session-1",
        mode: "random",
        contentType: "character",
        status: "playing",
        maxGuesses: 8,
        activeFields: [],
        guesses: [],
        startedAt: "2026-08-28T00:00:00Z",
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

describe("puzzleApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("retries a network failure with the same idempotency key", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("connection lost"))
      .mockResolvedValueOnce(successResponse());
    vi.stubGlobal("fetch", fetchMock);
    const { createPuzzleApi } = await loadPuzzleApi();
    const api = createPuzzleApi();
    const body = { idempotencyKey: "same-key" };

    const result = await api.resolvePuzzle("random", body);

    expect(result.session.id).toBe("session-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requestBodies = await Promise.all(
      fetchMock.mock.calls.map(async ([input]) =>
        JSON.parse(await (input as Request).clone().text()),
      ),
    );
    expect(requestBodies).toEqual([body, body]);
  });

  it.each([404, 405])(
    "marks the resolve endpoint unsupported after %s",
    async (status) => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ code: "INVALID_REQUEST", error: "missing" }),
          {
            status,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);
      const { createPuzzleApi, PuzzleResolveUnsupportedError } =
        await loadPuzzleApi();
      const api = createPuzzleApi();

      await expect(
        api.resolvePuzzle("daily", {
          idempotencyKey: "unsupported",
          difficulty: "normal",
        }),
      ).rejects.toBeInstanceOf(PuzzleResolveUnsupportedError);
      await expect(
        api.resolvePuzzle("daily", {
          idempotencyKey: "next-intent",
          difficulty: "hard",
        }),
      ).rejects.toBeInstanceOf(PuzzleResolveUnsupportedError);
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it("does not classify other server failures as unsupported", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "INTERNAL", error: "failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { createPuzzleApi, PuzzleApiError, PuzzleResolveUnsupportedError } =
      await loadPuzzleApi();

    await expect(
      createPuzzleApi().resolvePuzzle("random", {
        idempotencyKey: "server-failure",
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof PuzzleApiError &&
        !(error instanceof PuzzleResolveUnsupportedError) &&
        error.status === 500,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
