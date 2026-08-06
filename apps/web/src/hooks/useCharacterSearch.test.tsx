import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCharacterSearch } from "./useCharacterSearch";

vi.mock("../lib/api", () => ({
  api: { searchCharacters: vi.fn() },
}));

import { api } from "../lib/api";

const result = (id: string) => ({
  id,
  name: id,
  subtitle: "test",
  initials: id.slice(0, 2),
  avatarUrl: "",
  appearanceOrder: 1,
  workId: "th06_eosd",
  firstAppearance: { workTitle: "test", releaseYear: 1996 },
  species: [],
  locations: [],
  affiliations: [],
  hairColors: [],
});

describe("useCharacterSearch", () => {
  beforeEach(() => {
    vi.mocked(api.searchCharacters).mockReset();
  });

  it("passes the game session id to character search", async () => {
    vi.mocked(api.searchCharacters).mockResolvedValue({
      results: [result("reimu")],
      total: 1,
    });

    const { result: hook } = renderHook(() =>
      useCharacterSearch("灵梦", { delay: 0, sessionId: "session-1" }),
    );

    await waitFor(() => expect(hook.current.loading).toBe(false));
    expect(api.searchCharacters).toHaveBeenCalledWith(
      expect.objectContaining({ q: "灵梦", sessionId: "session-1" }),
      expect.any(AbortSignal),
    );
  });

  it("passes work filters to character search", async () => {
    vi.mocked(api.searchCharacters).mockResolvedValue({
      results: [result("reimu")],
      total: 1,
    });

    const { result: hook } = renderHook(() =>
      useCharacterSearch("灵梦", { delay: 0, workIds: "th06_eosd" }),
    );

    await waitFor(() => expect(hook.current.loading).toBe(false));
    expect(api.searchCharacters).toHaveBeenCalledWith(
      expect.objectContaining({ q: "灵梦", workIds: "th06_eosd" }),
      expect.any(AbortSignal),
    );
  });

  it("does not search while disabled", async () => {
    const { result: hook } = renderHook(() =>
      useCharacterSearch("灵梦", { delay: 0, enabled: false }),
    );

    await waitFor(() => expect(hook.current.loading).toBe(false));
    expect(api.searchCharacters).not.toHaveBeenCalled();
  });

  it("aborts and ignores a previous session search", async () => {
    let resolveFirst!: (value: {
      results: ReturnType<typeof result>[];
      total: number;
    }) => void;
    let resolveSecond!: (value: {
      results: ReturnType<typeof result>[];
      total: number;
    }) => void;
    const first = new Promise<{
      results: ReturnType<typeof result>[];
      total: number;
    }>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<{
      results: ReturnType<typeof result>[];
      total: number;
    }>((resolve) => {
      resolveSecond = resolve;
    });
    vi.mocked(api.searchCharacters)
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);

    const { rerender, result: hook } = renderHook(
      ({ sessionId }) => useCharacterSearch("灵梦", { delay: 0, sessionId }),
      { initialProps: { sessionId: "session-1" } },
    );
    await waitFor(() => expect(api.searchCharacters).toHaveBeenCalledTimes(1));
    const firstSignal = vi.mocked(api.searchCharacters).mock.calls[0][1];

    rerender({ sessionId: "session-2" });
    await waitFor(() => expect(api.searchCharacters).toHaveBeenCalledTimes(2));
    expect(firstSignal?.aborted).toBe(true);

    await act(async () => {
      resolveSecond({ results: [result("marisa")], total: 1 });
    });
    await waitFor(() => expect(hook.current.results[0]?.id).toBe("marisa"));

    await act(async () => {
      resolveFirst({ results: [result("reimu")], total: 1 });
    });
    expect(hook.current.results[0]?.id).toBe("marisa");
  });
});
