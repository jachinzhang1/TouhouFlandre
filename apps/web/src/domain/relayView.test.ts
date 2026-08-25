import { describe, expect, it } from "vitest";
import type { RelayStageView } from "@touhouflandre/shared";
import type { RelayProjectionState } from "./relayProjection";
import {
  normalizeCurrentRelaySelection,
  orderedRelayEncounters,
  selectRelayView,
} from "./relayView";

const stage: RelayStageView = {
  stageId: "stage-1",
  stageIndex: 1,
  status: "playing",
  encounters: [
    {
      encounterId: "encounter-own",
      encounterIndex: 1,
      status: "playing",
      members: [
        { memberId: "self", seat: 1, side: 1 },
        { memberId: "other", seat: 2, side: 2 },
      ],
    },
    {
      encounterId: "encounter-selected",
      encounterIndex: 2,
      status: "playing",
      members: [
        { memberId: "third", seat: 3, side: 1 },
        { memberId: "fourth", seat: 4, side: 2 },
      ],
    },
  ],
  encounterDetails: [
    {
      encounterId: "encounter-own",
      encounterIndex: 1,
      status: "playing",
      members: [
        { memberId: "self", seat: 1, side: 1 },
        { memberId: "other", seat: 2, side: 2 },
      ],
      capabilities: { canGuess: true, canPass: true, canForfeit: true },
      turnMemberId: "self",
      rows: [],
    },
  ],
};

const projection: RelayProjectionState = {
  matchIndex: 0,
  sequence: 1,
  ruleSetRef: { mode: "relay", key: "fixed_points", version: 1 },
  ranking: [],
  currentStageIndex: 1,
  standings: [
    {
      memberId: "self",
      seat: 1,
      score: 0,
      status: "active",
      lifeState: "healthy",
    },
  ],
  stagesByIndex: { 1: stage },
  viewerMemberId: "self",
  viewerRole: "player",
};

describe("relay view selectors", () => {
  it("keeps a valid encounter while normalizing a late current-stage selection", () => {
    const selection = normalizeCurrentRelaySelection(
      { scope: "current", encounterId: "encounter-selected" },
      stage,
      "self",
    );

    expect(selection).toEqual({
      scope: "current",
      stageIndex: 1,
      encounterId: "encounter-selected",
    });
  });

  it("keeps summary encounters navigable while details arrive incrementally", () => {
    const encounters = orderedRelayEncounters(stage);
    expect(encounters.map((encounter) => encounter.encounterId)).toEqual([
      "encounter-own",
      "encounter-selected",
    ]);
    expect(encounters[1]).toMatchObject({
      capabilities: { canGuess: false, canPass: false, canForfeit: false },
      rows: [],
    });

    const selected = selectRelayView(projection, {
      scope: "current",
      stageIndex: 1,
      encounterId: "encounter-selected",
    });
    expect(selected.encounter?.encounterId).toBe("encounter-selected");
    expect(selected.ownEncounter?.encounterId).toBe("encounter-own");
    expect(selected.isSelectedOwnEncounter).toBe(false);
  });
});
