import { describe, expect, it } from "vitest";
import type { RelayMatchFragment, RelayWsEvent } from "@touhouflandre/shared";
import {
  reduceRelayProjection,
  relayProjectionFromFragment,
} from "./relayProjection";

const fragment: RelayMatchFragment = {
  ruleSetRef: { mode: "relay", key: "fixed_points", version: 1 },
  standings: [],
  currentStage: {
    stageId: "stage-1",
    stageIndex: 1,
    status: "playing",
    encounters: [
      {
        encounterId: "encounter-1",
        encounterIndex: 1,
        status: "playing",
        members: [],
      },
      {
        encounterId: "encounter-2",
        encounterIndex: 2,
        status: "playing",
        members: [],
      },
    ],
    encounterDetails: [
      {
        encounterId: "encounter-1",
        encounterIndex: 1,
        status: "playing",
        members: [],
        capabilities: { canGuess: true, canPass: true, canForfeit: true },
        rows: [],
      },
      {
        encounterId: "encounter-2",
        encounterIndex: 2,
        status: "playing",
        members: [],
        capabilities: { canGuess: false, canPass: false, canForfeit: false },
        rows: [],
      },
    ],
  },
};

function turnEvent(
  sequence: number,
  encounterId: string,
  index: number,
): RelayWsEvent {
  return {
    type: "relay.encounter.turn.guess",
    eventId: `event-${sequence}`,
    roomId: "room-1",
    sequence,
    occurredAt: "2026-08-24T00:00:00Z",
    payload: {
      matchIndex: 0,
      stageId: "stage-1",
      stageIndex: 1,
      encounterId,
      memberId: `member-${encounterId}`,
      row: {
        index,
        memberId: `member-${encounterId}`,
        seat: 1,
        kind: "guess",
      },
    },
  };
}

describe("relay projection", () => {
  it("updates one encounter without clearing another board", () => {
    const initial = relayProjectionFromFragment(0, fragment);
    const next = reduceRelayProjection(
      initial,
      turnEvent(1, "encounter-1", 1),
    );
    const details = next.stagesByIndex[1].encounterDetails ?? [];

    expect(details.find((item) => item.encounterId === "encounter-1")?.rows).toHaveLength(
      1,
    );
    expect(
      details.find((item) => item.encounterId === "encounter-2")?.rows,
    ).toEqual([]);
    expect(
      details.find((item) => item.encounterId === "encounter-2")?.capabilities
        .canGuess,
    ).toBe(false);
  });

  it("ignores duplicate and late frames by sequence", () => {
    const initial = relayProjectionFromFragment(0, fragment);
    const first = turnEvent(2, "encounter-1", 1);
    const second = turnEvent(1, "encounter-2", 1);

    const afterFirst = reduceRelayProjection(initial, first);
    expect(reduceRelayProjection(afterFirst, first)).toBe(afterFirst);
    expect(reduceRelayProjection(afterFirst, second)).toBe(afterFirst);
  });
});
