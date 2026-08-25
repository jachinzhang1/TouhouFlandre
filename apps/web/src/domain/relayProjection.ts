import type {
  Envelope,
  MultiParticipantRole,
  RelayEncounterCapabilities,
  RelayEncounterView,
  RelayMatchFragment,
  RelayRankingView,
  RelayRuleSetRef,
  RelayStageView,
  RelayStandingView,
  RelayTurnRow,
  RelayWsEvent,
} from "@touhouflandre/shared";

export interface RelayProjectionState {
  matchIndex: number;
  sequence: number;
  ruleSetRef: RelayRuleSetRef;
  plannedStages?: number;
  ranking: RelayRankingView[];
  currentStageIndex?: number;
  standings: RelayStandingView[];
  stagesByIndex: Readonly<Record<number, RelayStageView>>;
  viewerMemberId?: string;
  viewerRole?: MultiParticipantRole;
}

const EMPTY_CAPABILITIES: RelayEncounterCapabilities = {
  canGuess: false,
  canPass: false,
  canForfeit: false,
};

export function relayProjectionFromFragment(
  matchIndex: number,
  fragment: RelayMatchFragment,
  sequence = 0,
  viewer?: { memberId: string; role: MultiParticipantRole },
): RelayProjectionState {
  const stages: Record<number, RelayStageView> = {};
  for (const stage of fragment.historySummary ?? []) {
    stages[stage.stageIndex] = stage;
  }
  if (fragment.currentStage) {
    stages[fragment.currentStage.stageIndex] = fragment.currentStage;
  }
  return {
    matchIndex,
    sequence,
    ruleSetRef: fragment.ruleSetRef,
    plannedStages: fragment.plannedStages,
    ranking: fragment.ranking ?? [],
    currentStageIndex: fragment.currentStage?.stageIndex,
    standings: fragment.standings,
    stagesByIndex: stages,
    viewerMemberId: viewer?.memberId,
    viewerRole: viewer?.role,
  };
}

export function emptyRelayProjection(
  matchIndex: number,
  ruleSetRef: RelayRuleSetRef,
  plannedStages?: number,
  viewer?: { memberId: string; role: MultiParticipantRole },
): RelayProjectionState {
  return {
    matchIndex,
    sequence: 0,
    ruleSetRef,
    plannedStages,
    ranking: [],
    standings: [],
    stagesByIndex: {},
    viewerMemberId: viewer?.memberId,
    viewerRole: viewer?.role,
  };
}

export function isRelayWsEvent(event: Envelope): event is RelayWsEvent {
  return event.type.startsWith("relay.");
}

export function finishRelayProjection(
  state: RelayProjectionState,
  fragment: Pick<RelayMatchFragment, "standings" | "ranking">,
  sequence: number,
): RelayProjectionState {
  return {
    ...state,
    sequence: Math.max(state.sequence, sequence),
    standings: fragment.standings,
    ranking: fragment.ranking ?? [],
  };
}

export function reduceRelayProjection(
  state: RelayProjectionState,
  event: RelayWsEvent,
): RelayProjectionState {
  if (
    event.sequence <= state.sequence ||
    event.payload.matchIndex !== state.matchIndex
  ) {
    return state;
  }

  switch (event.type) {
    case "relay.stage.started":
      return applyStage(state, event.sequence, {
        stageId: event.payload.stageId,
        stageIndex: event.payload.stageIndex,
        startsAt: event.payload.startsAt,
        status: event.payload.status,
        encounters: event.payload.encounters,
        byeMemberId: event.payload.byeMemberId,
      });

    case "relay.encounter.started": {
      const stage = stageForEvent(state, event.payload.stageIndex);
      const existing = findEncounter(stage, event.payload.encounterId);
      const detailWithoutCapabilities = {
        encounterId: event.payload.encounterId,
        encounterIndex: event.payload.encounterIndex,
        status: event.payload.status,
        members: event.payload.members,
        startsAt: event.payload.startsAt,
        deadline: event.payload.deadline,
        turnMemberId: event.payload.turnMemberId,
        turnSeat: event.payload.turnSeat,
        turnDeadline: event.payload.turnDeadline,
        maxTurnsPerPlayer: event.payload.maxTurnsPerPlayer,
        maxSkipsPerPlayer: event.payload.maxSkipsPerPlayer,
        rows: existing?.rows ?? [],
      };
      const detail: RelayEncounterView = {
        ...detailWithoutCapabilities,
        capabilities: capabilitiesForEncounter(
          state,
          detailWithoutCapabilities,
        ),
      };
      return applyEncounter(state, event.sequence, stage, detail);
    }

    case "relay.encounter.turn.guess":
    case "relay.encounter.turn.pass":
    case "relay.encounter.turn.timeout": {
      const stage = stageForEvent(state, event.payload.stageIndex);
      const existing = findEncounter(stage, event.payload.encounterId);
      const detail = existing ?? emptyEncounter(event.payload);
      const rows = replaceTurnRow(detail.rows, event.payload.row);
      const nextDetail = {
        ...detail,
        status: "playing",
        rows,
        turnMemberId: event.payload.nextTurnMemberId,
        turnSeat: event.payload.nextTurnSeat,
        turnDeadline: event.payload.nextTurnDeadline,
      } satisfies RelayEncounterView;
      return applyEncounter(state, event.sequence, stage, {
        ...nextDetail,
        capabilities: capabilitiesForEncounter(state, nextDetail),
      });
    }

    case "relay.encounter.ended": {
      const stage = stageForEvent(state, event.payload.stageIndex);
      const existing = findEncounter(stage, event.payload.encounterId);
      const detail = existing ?? emptyEncounter(event.payload);
      return applyEncounter(state, event.sequence, stage, {
        ...detail,
        status: "ended",
        outcome: event.payload.outcome,
        winnerMemberId: event.payload.winnerMemberId,
        answer: event.payload.answer,
        rows: event.payload.turns ?? detail.rows,
        capabilities: EMPTY_CAPABILITIES,
      });
    }

    case "relay.stage.ended": {
      const stage = stageForEvent(state, event.payload.stageIndex);
      return applyStage(
        {
          ...state,
          standings: event.payload.standings,
        },
        event.sequence,
        {
          ...stage,
          stageId: event.payload.stageId,
          status: "ended",
          settlement: event.payload.settlement,
          byeMemberId: event.payload.byeMemberId,
        },
      );
    }
  }
}

function capabilitiesForEncounter(
  state: RelayProjectionState,
  encounter: Pick<RelayEncounterView, "status" | "members" | "turnMemberId">,
): RelayEncounterCapabilities {
  const viewerMemberId = state.viewerMemberId;
  const standing = state.standings.find(
    (candidate) => candidate.memberId === viewerMemberId,
  );
  const mayAct =
    state.viewerRole === "player" &&
    Boolean(viewerMemberId) &&
    standing?.status === "active" &&
    encounter.status === "playing" &&
    encounter.turnMemberId === viewerMemberId &&
    encounter.members.some((member) => member.memberId === viewerMemberId);
  if (!mayAct) return EMPTY_CAPABILITIES;
  return { canGuess: true, canPass: true, canForfeit: true };
}

function applyStage(
  state: RelayProjectionState,
  sequence: number,
  stage: RelayStageView,
): RelayProjectionState {
  return {
    ...state,
    sequence,
    currentStageIndex:
      stage.status === "ended" ? state.currentStageIndex : stage.stageIndex,
    stagesByIndex: { ...state.stagesByIndex, [stage.stageIndex]: stage },
  };
}

function applyEncounter(
  state: RelayProjectionState,
  sequence: number,
  stage: RelayStageView,
  detail: RelayEncounterView,
): RelayProjectionState {
  const details = [...(stage.encounterDetails ?? [])];
  const index = details.findIndex(
    (candidate) => candidate.encounterId === detail.encounterId,
  );
  if (index < 0) details.push(detail);
  else details[index] = detail;

  const summaries = stage.encounters.some(
    (candidate) => candidate.encounterId === detail.encounterId,
  )
    ? stage.encounters.map((candidate) =>
        candidate.encounterId === detail.encounterId
          ? { ...candidate, status: detail.status, members: detail.members }
          : candidate,
      )
    : [
        ...stage.encounters,
        {
          encounterId: detail.encounterId,
          encounterIndex: detail.encounterIndex,
          status: detail.status,
          members: detail.members,
        },
      ];

  return applyStage(state, sequence, {
    ...stage,
    encounters: summaries,
    encounterDetails: details,
  });
}

function stageForEvent(
  state: RelayProjectionState,
  stageIndex: number,
): RelayStageView {
  return (
    state.stagesByIndex[stageIndex] ?? {
      stageId: "",
      stageIndex,
      status: "playing",
      encounters: [],
    }
  );
}

function findEncounter(
  stage: RelayStageView,
  encounterId: string,
): RelayEncounterView | undefined {
  return stage.encounterDetails?.find(
    (candidate) => candidate.encounterId === encounterId,
  );
}

function emptyEncounter(
  payload:
    | Extract<RelayWsEvent, { type: "relay.encounter.turn.guess" }>["payload"]
    | Extract<RelayWsEvent, { type: "relay.encounter.ended" }>["payload"],
): RelayEncounterView {
  return {
    encounterId: payload.encounterId,
    encounterIndex: 0,
    status: "playing",
    members: [],
    capabilities: EMPTY_CAPABILITIES,
    rows: [],
  };
}

function replaceTurnRow(
  rows: readonly RelayTurnRow[],
  row: RelayTurnRow,
): RelayTurnRow[] {
  const next = [...rows];
  const index = next.findIndex((candidate) => candidate.index === row.index);
  if (index < 0) next.push(row);
  else next[index] = row;
  return next.sort((left, right) => left.index - right.index);
}
