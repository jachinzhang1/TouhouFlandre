import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { useRelayHistory } from "./useRelayHistory";

vi.mock("../lib/api", () => ({
  api: {
    listRelayStageHistory: vi.fn(),
  },
}));

type HistoryPage = Awaited<ReturnType<typeof api.listRelayStageHistory>>;

const stage = (stageIndex: number): HistoryPage["stages"][number] =>
  ({
    stageId: `stage-${stageIndex}`,
    stageIndex,
    status: "ended",
    encounters: [
      {
        encounterId: `encounter-${stageIndex}`,
        encounterIndex: 1,
        status: "ended",
        outcome: "win",
        winnerMemberId: "member-1",
        members: [
          { memberId: "member-1", seat: 1, side: 1 },
          { memberId: "member-2", seat: 2, side: 2 },
        ],
        capabilities: { canGuess: false, canPass: false, canForfeit: false },
        rows: [],
        answer: {
          id: "reimu",
          names: { zhHans: "博丽灵梦", ja: "博麗霊夢" },
          avatarUrl: "/reimu.png",
          firstAppearance: {
            workId: "th01",
            workTitle: "东方灵异传",
            mainlineIndex: 1,
          },
        },
      },
    ],
    settlement: [],
  }) as unknown as HistoryPage["stages"][number];

describe("useRelayHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads pages until the requested stage and deduplicates concurrent calls", async () => {
    vi.mocked(api.listRelayStageHistory)
      .mockResolvedValueOnce({ stages: [stage(1)], nextCursor: "next" })
      .mockResolvedValueOnce({ stages: [stage(2)], nextCursor: undefined });
    const { result } = renderHook(() => useRelayHistory("room-1", "token", 0));

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.loadStage(2);
      second = result.current.loadStage(2);
    });
    expect(first).toBe(second);
    await act(async () => first);

    expect(api.listRelayStageHistory).toHaveBeenCalledTimes(2);
    expect(api.listRelayStageHistory).toHaveBeenNthCalledWith(
      2,
      "room-1",
      "token",
      0,
      { after: "next", limit: 20 },
    );
    expect(Object.keys(result.current.stagesByIndex)).toEqual(["1", "2"]);
    expect(
      result.current.stagesByIndex[2].encounterDetails?.[0].answer,
    ).toMatchObject({ name: "博丽灵梦", workCode: "TH01" });
  });

  it("retries an error without duplicating the cached stage", async () => {
    vi.mocked(api.listRelayStageHistory)
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({ stages: [stage(1)], nextCursor: undefined });
    const { result } = renderHook(() => useRelayHistory("room-1", "token", 0));

    await act(async () => result.current.loadStage(1));
    expect(result.current.errorByStageIndex[1]).toBe("temporary failure");

    await act(async () => result.current.retryStage(1));
    await waitFor(() =>
      expect(Object.keys(result.current.stagesByIndex)).toEqual(["1"]),
    );
    expect(result.current.errorByStageIndex[1]).toBeUndefined();
    expect(api.listRelayStageHistory).toHaveBeenCalledTimes(2);
  });
});
