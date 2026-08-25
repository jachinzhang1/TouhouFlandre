import type {
  RelayEncounterView,
  RelayStageSettlementView,
  RelayStageView,
  RelayStandingView,
} from "@touhouflandre/shared";
import type { RelayProjectionState } from "./relayProjection";

export type RelayViewScope = "current" | "history";

export interface RelayViewSelection {
  scope: RelayViewScope;
  stageIndex?: number;
  encounterId?: string;
}

export interface RelaySelectedView {
  stage?: RelayStageView;
  encounter?: RelayEncounterView;
  ownEncounter?: RelayEncounterView;
  standing?: RelayStandingView;
  settlement?: RelayStageSettlementView;
  isBye: boolean;
  isSelectedOwnEncounter: boolean;
}

export function currentRelayStage(
  projection: RelayProjectionState,
): RelayStageView | undefined {
  return projection.currentStageIndex === undefined
    ? undefined
    : projection.stagesByIndex[projection.currentStageIndex];
}

export function defaultEncounterId(
  stage: RelayStageView | undefined,
  viewerMemberId?: string | null,
): string | undefined {
  if (!stage) return undefined;
  const encounters = orderedRelayEncounters(stage);
  const own = encounters.find((encounter) =>
    encounter.members.some((member) => member.memberId === viewerMemberId),
  );
  return own?.encounterId ?? encounters[0]?.encounterId;
}

export function normalizeCurrentRelaySelection(
  selection: RelayViewSelection,
  stage: RelayStageView,
  viewerMemberId?: string | null,
): RelayViewSelection {
  if (selection.scope !== "current") return selection;
  const encounterId = stage.encounters.some(
    (encounter) => encounter.encounterId === selection.encounterId,
  )
    ? selection.encounterId
    : defaultEncounterId(stage, viewerMemberId);
  if (
    selection.stageIndex === stage.stageIndex &&
    selection.encounterId === encounterId
  ) {
    return selection;
  }
  return {
    scope: "current",
    stageIndex: stage.stageIndex,
    encounterId,
  };
}

export function selectRelayView(
  projection: RelayProjectionState,
  selection: RelayViewSelection,
  historyByStageIndex: Readonly<Record<number, RelayStageView>> = {},
): RelaySelectedView {
  const viewerMemberId = projection.viewerMemberId;
  const stage =
    selection.scope === "history" && selection.stageIndex !== undefined
      ? historyByStageIndex[selection.stageIndex]
      : currentRelayStage(projection);
  const details = orderedRelayEncounters(stage);
  const ownEncounter = details.find((encounter) =>
    encounter.members.some((member) => member.memberId === viewerMemberId),
  );
  const selectedId =
    selection.encounterId ?? defaultEncounterId(stage, viewerMemberId);
  const encounter =
    details.find((candidate) => candidate.encounterId === selectedId) ??
    ownEncounter ??
    details[0];
  const standing = projection.standings.find(
    (candidate) => candidate.memberId === viewerMemberId,
  );
  const settlement = stage?.settlement?.find(
    (candidate) => candidate.memberId === viewerMemberId,
  );
  return {
    stage,
    encounter,
    ownEncounter,
    standing,
    settlement,
    isBye: stage?.byeMemberId === viewerMemberId,
    isSelectedOwnEncounter: Boolean(
      encounter && ownEncounter?.encounterId === encounter.encounterId,
    ),
  };
}

export function relayActionCapability(
  selected: RelaySelectedView,
  action: "guess" | "pass" | "forfeit",
): boolean {
  if (!selected.isSelectedOwnEncounter || !selected.encounter) return false;
  if (action === "guess") return selected.encounter.capabilities.canGuess;
  if (action === "pass") return selected.encounter.capabilities.canPass;
  return selected.encounter.capabilities.canForfeit;
}

export function relaySkipUsage(
  encounter: RelayEncounterView | undefined,
  memberId?: string | null,
): { used: number; remaining: number; maximum: number } {
  const maximum = encounter?.maxSkipsPerPlayer ?? 0;
  const used =
    encounter?.rows.filter(
      (row) => row.memberId === memberId && row.kind !== "guess",
    ).length ?? 0;
  return { used, remaining: Math.max(0, maximum - used), maximum };
}

export function orderedRelayEncounters(
  stage: RelayStageView | undefined,
): RelayEncounterView[] {
  if (!stage) return [];
  const details = new Map(
    (stage.encounterDetails ?? []).map((encounter) => [
      encounter.encounterId,
      encounter,
    ]),
  );
  const encounters = stage.encounters.map(
    (summary) =>
      details.get(summary.encounterId) ?? {
        ...summary,
        capabilities: {
          canGuess: false,
          canPass: false,
          canForfeit: false,
        },
        rows: [],
      },
  );
  const known = new Set(stage.encounters.map((summary) => summary.encounterId));
  encounters.push(
    ...(stage.encounterDetails ?? []).filter(
      (encounter) => !known.has(encounter.encounterId),
    ),
  );
  return encounters.sort(
    (left, right) => left.encounterIndex - right.encounterIndex,
  );
}
