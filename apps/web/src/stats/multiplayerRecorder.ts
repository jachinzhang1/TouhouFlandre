import type {
  Envelope,
  MatchEndedPayload,
  MatchStartedPayload,
  RelayEncounterEndedPayload,
  RelayEncounterStartedPayload,
  RelayEncounterTurnGuessPayload,
  RelayEncounterTurnPassPayload,
  RelayEncounterTurnTimeoutPayload,
  RelayStageEndedPayload,
  RelayStageStartedPayload,
  RelayTurnRow,
  RoundEndedPayload,
  RoundStartedPayload,
} from "@touhouflandre/shared";
import { putStatsDraft, stableRecordId, statsDb } from "./db";
import {
  STATS_SCHEMA_VERSION,
  type MultiplayerStatsDraft,
  type StatsGuessSnapshot,
  type StatsOutcome,
  type StatsRelayStage,
  type StatsRelayTurnSnapshot,
} from "./types";
import {
  boardForMemberId,
  resultForMemberId,
  scoreForMemberId,
} from "../domain/memberCollections";
import { assertStatsPrivacy } from "./privacy";

export interface MultiplayerTimingSnapshot {
  activeElapsedMs: number;
  guessCompletedElapsedMs: number[];
}

export interface MultiplayerRoomContext {
  playerLimit?: number;
}

function durationsForGuesses(
  completed: number[],
  count: number,
): (number | undefined)[] {
  return Array.from({ length: count }, (_, index) => {
    const current = completed[index];
    const previous = index === 0 ? 0 : completed[index - 1];
    return Number.isFinite(current) && Number.isFinite(previous)
      ? Math.max(0, current - previous)
      : undefined;
  });
}

async function draftId(
  roomId: string,
  matchIndex: number,
  viewerMemberId: string,
): Promise<string> {
  return stableRecordId(`multi:${roomId}:${matchIndex}:${viewerMemberId}`);
}

async function roomSourceKey(
  roomId: string,
  viewerMemberId: string,
): Promise<string> {
  return stableRecordId(`multi-room:${roomId}:${viewerMemberId}`);
}

async function relayEncounterKey(
  roomId: string,
  matchIndex: number,
  stageIndex: number,
  encounterId: string,
  viewerMemberId: string,
): Promise<string> {
  return stableRecordId(
    `multi-relay:${roomId}:${matchIndex}:${stageIndex}:${encounterId}:${viewerMemberId}`,
  );
}

function relayTurnSnapshot(
  row: RelayTurnRow,
  viewerMemberId: string,
  durationMs?: number,
): StatsRelayTurnSnapshot {
  const actor = row.memberId === viewerMemberId ? "self" : "other";
  if (row.kind !== "guess" || !row.guess) {
    return {
      index: row.index,
      actor,
      kind: row.kind === "pass" ? "pass" : "timeout",
    };
  }
  return {
    index: row.index,
    actor,
    kind: "guess",
    guess: {
      id: row.guess.guessId,
      name: row.guess.guessName,
      avatarUrl: row.guess.guessAvatarUrl,
      correct: row.guess.isCorrect,
      ...(durationMs === undefined ? {} : { durationMs }),
    },
  };
}

function outcomeForMatch(
  payload: MatchEndedPayload,
  viewerMemberId: string,
): StatsOutcome {
  const result =
    payload.viewerResult ??
    resultForMemberId(payload.results, viewerMemberId) ??
    "draw";
  if (result === "win") return "win";
  if (result === "draw") return "draw";
  if (payload.reason === "forfeit") return "forfeit";
  if (payload.reason === "disconnect") return "disconnect";
  return "loss";
}

export async function recordMultiplayerEvent(
  event: Envelope,
  viewerMemberId: string,
  timing?: MultiplayerTimingSnapshot,
  context?: MultiplayerRoomContext,
): Promise<void> {
  const identity = viewerMemberId;
  if (event.type === "match.started") {
    const payload = event.payload as unknown as MatchStartedPayload;
    const id = await draftId(event.roomId, payload.matchIndex, identity);
    if (await statsDb.records.get(id)) return;
    const existing = await statsDb.drafts.get(id);
    if (existing?.kind === "multiplayer") {
      const next = {
        ...existing,
        multiplayerMode: payload.mode,
        ruleSetKey: payload.ruleSetRef.key,
        ruleSetVersion: payload.ruleSetRef.version,
        rosterSize: payload.rosterSize ?? existing.rosterSize,
        scoringMode:
          payload.mode === "race"
            ? (payload.scoringMode ?? existing.scoringMode ?? "wins")
            : undefined,
        updatedAt: event.occurredAt,
      } satisfies MultiplayerStatsDraft;
      await putStatsDraft(next);
      return;
    }
    if (existing) return;
    await putStatsDraft({
      id,
      kind: "multiplayer",
      sourceKey: await roomSourceKey(event.roomId, identity),
      startedAt: event.occurredAt,
      updatedAt: event.occurredAt,
      format: payload.format,
      multiplayerMode: payload.mode ?? "race",
      difficulty: payload.questionScope?.difficulty ?? "unknown",
      matchIndex: payload.matchIndex,
      playerLimit: context?.playerLimit,
      scoringMode:
        payload.mode === "race" ? (payload.scoringMode ?? "wins") : undefined,
      ruleSetKey: payload.ruleSetRef.key,
      ruleSetVersion: payload.ruleSetRef.version,
      rosterSize: payload.rosterSize,
      rounds: [],
      relayStages: payload.mode === "relay" ? [] : undefined,
    });
    return;
  }

  if (event.type === "relay.stage.started") {
    const payload = event.payload as unknown as RelayStageStartedPayload;
    const id = await draftId(event.roomId, payload.matchIndex, identity);
    const draft = await statsDb.drafts.get(id);
    if (!draft || draft.kind !== "multiplayer") return;
    const ownEncounter = payload.encounters.find((encounter) =>
      encounter.members.some((member) => member.memberId === identity),
    );
    if (!ownEncounter && payload.byeMemberId !== identity) return;
    const encounterKey = ownEncounter
      ? await relayEncounterKey(
          event.roomId,
          payload.matchIndex,
          payload.stageIndex,
          ownEncounter.encounterId,
          identity,
        )
      : undefined;
    const existing =
      draft.activeRelayStage?.stageIndex === payload.stageIndex &&
      draft.activeRelayStage.assignment === (ownEncounter ? "paired" : "bye") &&
      draft.activeRelayStage.encounterKey === encounterKey
        ? draft.activeRelayStage
        : undefined;
    draft.activeRelayStage = {
      stageIndex: payload.stageIndex,
      startedAt: existing?.startedAt ?? event.occurredAt,
      assignment: ownEncounter ? "paired" : "bye",
      encounterKey,
      activeElapsedMs: existing?.activeElapsedMs ?? 0,
      guessCompletedElapsedMs: existing?.guessCompletedElapsedMs ?? [],
      turns: existing?.turns ?? [],
      encounter: existing?.encounter,
      encounterEndReason: existing?.encounterEndReason,
    };
    draft.updatedAt = event.occurredAt;
    await putStatsDraft(draft);
    return;
  }

  if (event.type === "relay.encounter.started") {
    const payload = event.payload as unknown as RelayEncounterStartedPayload;
    if (!payload.members.some((member) => member.memberId === identity)) return;
    const id = await draftId(event.roomId, payload.matchIndex, identity);
    const draft = await statsDb.drafts.get(id);
    if (!draft || draft.kind !== "multiplayer") return;
    const existing =
      draft.activeRelayStage?.stageIndex === payload.stageIndex
        ? draft.activeRelayStage
        : undefined;
    draft.activeRelayStage = {
      stageIndex: payload.stageIndex,
      startedAt: payload.startsAt ?? existing?.startedAt ?? event.occurredAt,
      assignment: "paired",
      encounterKey: await relayEncounterKey(
        event.roomId,
        payload.matchIndex,
        payload.stageIndex,
        payload.encounterId,
        identity,
      ),
      activeElapsedMs: existing?.activeElapsedMs ?? 0,
      guessCompletedElapsedMs: existing?.guessCompletedElapsedMs ?? [],
      turns: existing?.turns ?? [],
      encounter: existing?.encounter,
      encounterEndReason: existing?.encounterEndReason,
    };
    draft.updatedAt = event.occurredAt;
    await putStatsDraft(draft);
    return;
  }

  if (
    event.type === "relay.encounter.turn.guess" ||
    event.type === "relay.encounter.turn.pass" ||
    event.type === "relay.encounter.turn.timeout"
  ) {
    const payload = event.payload as unknown as
      | RelayEncounterTurnGuessPayload
      | RelayEncounterTurnPassPayload
      | RelayEncounterTurnTimeoutPayload;
    const id = await draftId(event.roomId, payload.matchIndex, identity);
    const draft = await statsDb.drafts.get(id);
    const active =
      draft?.kind === "multiplayer" &&
      draft.activeRelayStage?.stageIndex === payload.stageIndex
        ? draft.activeRelayStage
        : undefined;
    if (!draft || draft.kind !== "multiplayer" || !active?.encounterKey) return;
    const key = await relayEncounterKey(
      event.roomId,
      payload.matchIndex,
      payload.stageIndex,
      payload.encounterId,
      identity,
    );
    if (active.encounterKey !== key) return;
    const turn = relayTurnSnapshot(payload.row, identity);
    active.turns = [
      ...active.turns.filter((candidate) => candidate.index !== turn.index),
      turn,
    ].sort((left, right) => left.index - right.index);
    draft.updatedAt = event.occurredAt;
    await putStatsDraft(draft);
    return;
  }

  if (event.type === "relay.encounter.ended") {
    const payload = event.payload as unknown as RelayEncounterEndedPayload;
    const id = await draftId(event.roomId, payload.matchIndex, identity);
    const draft = await statsDb.drafts.get(id);
    const active =
      draft?.kind === "multiplayer" &&
      draft.activeRelayStage?.stageIndex === payload.stageIndex
        ? draft.activeRelayStage
        : undefined;
    if (!draft || draft.kind !== "multiplayer" || !active?.encounterKey) return;
    const key = await relayEncounterKey(
      event.roomId,
      payload.matchIndex,
      payload.stageIndex,
      payload.encounterId,
      identity,
    );
    if (active.encounterKey !== key) return;
    const rows = payload.turns ?? [];
    const completed =
      (timing?.guessCompletedElapsedMs.length ?? 0) >=
      active.guessCompletedElapsedMs.length
        ? (timing?.guessCompletedElapsedMs ?? [])
        : active.guessCompletedElapsedMs;
    const durations = durationsForGuesses(
      completed,
      rows.filter(
        (row) => row.memberId === identity && row.kind === "guess" && row.guess,
      ).length,
    );
    let selfGuessIndex = 0;
    const turns = rows.map((row) => {
      const duration =
        row.memberId === identity && row.kind === "guess" && row.guess
          ? durations[selfGuessIndex++]
          : undefined;
      return relayTurnSnapshot(row, identity, duration);
    });
    const result =
      payload.winnerMemberId === identity
        ? "win"
        : payload.winnerMemberId === null
          ? "draw"
          : "loss";
    active.turns = turns;
    active.encounterEndReason = payload.outcome;
    active.encounter = {
      roundIndex: payload.stageIndex,
      startedAt: active.startedAt,
      endedAt: event.occurredAt,
      durationMs: Math.max(
        0,
        timing?.activeElapsedMs ?? 0,
        active.activeElapsedMs,
      ),
      result,
      answer: {
        id: payload.answer.id,
        name: payload.answer.name,
        avatarUrl: payload.answer.avatarUrl,
        work: {
          id: payload.answer.workId,
          title: payload.answer.workTitle,
          code: payload.answer.workCode,
        },
      },
      guesses: turns.flatMap((turn) =>
        turn.kind === "guess" ? [turn.guess] : [],
      ),
      turns,
    };
    draft.updatedAt = event.occurredAt;
    await putStatsDraft(draft);
    return;
  }

  if (event.type === "relay.stage.ended") {
    const payload = event.payload as unknown as RelayStageEndedPayload;
    const settlement = payload.settlement.find(
      (entry) => entry.memberId === identity,
    );
    if (!settlement) return;
    const id = await draftId(event.roomId, payload.matchIndex, identity);
    const draft = await statsDb.drafts.get(id);
    if (!draft || draft.kind !== "multiplayer") return;
    const active =
      draft.activeRelayStage?.stageIndex === payload.stageIndex
        ? draft.activeRelayStage
        : undefined;
    const existing = draft.relayStages?.find(
      (stage) => stage.stageIndex === payload.stageIndex,
    );
    const encounter = active?.encounter ?? existing?.encounter;
    const stage: StatsRelayStage = {
      stageIndex: payload.stageIndex,
      assignment: settlement.assignment,
      outcome: settlement.outcome,
      encounterEndReason:
        active?.encounterEndReason ?? existing?.encounterEndReason,
      scoreBefore: settlement.scoreBefore,
      scoreDelta: settlement.scoreDelta,
      scoreAfter: settlement.scoreAfter,
      lifeBefore: settlement.lifeBefore,
      lifeAfter: settlement.lifeAfter,
      lifeTransition: settlement.lifeTransition,
      encounter,
    };
    draft.relayStages = [
      ...(draft.relayStages ?? []).filter(
        (candidate) => candidate.stageIndex !== payload.stageIndex,
      ),
      stage,
    ].sort((left, right) => left.stageIndex - right.stageIndex);
    if (encounter) {
      draft.rounds = [
        ...draft.rounds.filter(
          (round) => round.roundIndex !== encounter.roundIndex,
        ),
        encounter,
      ].sort((left, right) => left.roundIndex - right.roundIndex);
    }
    draft.activeRelayStage = undefined;
    draft.updatedAt = event.occurredAt;
    await putStatsDraft(draft);
    return;
  }

  if (event.type === "round.started") {
    const payload = event.payload as unknown as RoundStartedPayload;
    const id = await draftId(event.roomId, payload.matchIndex, viewerMemberId);
    const draft = await statsDb.drafts.get(id);
    if (!draft || draft.kind !== "multiplayer") return;
    draft.activeRound = {
      roundIndex: payload.roundIndex,
      startedAt: payload.startsAt,
      activeElapsedMs: 0,
      guessCompletedElapsedMs: [],
    };
    draft.updatedAt = event.occurredAt;
    await putStatsDraft(draft);
    return;
  }

  if (event.type === "round.ended") {
    const payload = event.payload as unknown as RoundEndedPayload;
    const id = await draftId(event.roomId, payload.matchIndex, viewerMemberId);
    const draft = await statsDb.drafts.get(id);
    if (!draft || draft.kind !== "multiplayer") return;
    const active =
      draft.activeRound?.roundIndex === payload.roundIndex
        ? draft.activeRound
        : undefined;
    const elapsed = Math.max(
      0,
      timing?.activeElapsedMs ?? 0,
      active?.activeElapsedMs ?? 0,
    );
    const completed =
      (timing?.guessCompletedElapsedMs.length ?? 0) >=
      (active?.guessCompletedElapsedMs.length ?? 0)
        ? (timing?.guessCompletedElapsedMs ?? [])
        : (active?.guessCompletedElapsedMs ?? []);
    const multiplayerMode = draft.multiplayerMode ?? "race";
    const board = boardForMemberId(payload.boards, identity);
    const durations = durationsForGuesses(completed, board.length);
    let turns: StatsRelayTurnSnapshot[] | undefined;
    let guesses: StatsGuessSnapshot[];
    if (multiplayerMode === "relay" && payload.turns) {
      turns = payload.turns.map((turn) => {
        const actor = turn.memberId === identity ? "self" : "other";
        if (turn.kind !== "guess" || !turn.guess) {
          return {
            index: turn.index,
            actor,
            kind: turn.kind === "pass" ? "pass" : "timeout",
          };
        }
        return {
          index: turn.index,
          actor,
          kind: "guess",
          guess: {
            id: turn.guess.guessId,
            name: turn.guess.guessName,
            avatarUrl: turn.guess.guessAvatarUrl,
            correct: turn.guess.isCorrect,
          },
        };
      });
      guesses = turns.flatMap((turn) =>
        turn.kind === "guess" ? [turn.guess] : [],
      );
    } else {
      guesses = board.map((guess, index) => ({
        id: guess.guessId,
        name: guess.guessName,
        avatarUrl: guess.guessAvatarUrl,
        correct: guess.isCorrect,
        durationMs: durations[index],
      }));
    }
    const viewerPlacement = payload.placements?.find(
      (entry) => entry.memberId === identity,
    );
    const round = {
      roundIndex: payload.roundIndex,
      startedAt: active?.startedAt ?? event.occurredAt,
      endedAt: event.occurredAt,
      durationMs: elapsed,
      result:
        payload.viewerResult ??
        resultForMemberId(payload.results, identity) ??
        "draw",
      answer: {
        id: payload.answer.id,
        name: payload.answer.name,
        avatarUrl: payload.answer.avatarUrl,
        work: {
          id: payload.answer.workId,
          title: payload.answer.workTitle,
          code: payload.answer.workCode,
        },
      },
      guesses,
      turns,
      pointsAwarded: viewerPlacement?.pointsAwarded,
      participationStatus:
        viewerPlacement?.status === "active"
          ? undefined
          : viewerPlacement?.status,
    };
    draft.rounds = [
      ...draft.rounds.filter(
        (entry) => entry.roundIndex !== payload.roundIndex,
      ),
      round,
    ].sort((a, b) => a.roundIndex - b.roundIndex);
    draft.activeRound = undefined;
    draft.updatedAt = event.occurredAt;
    await putStatsDraft(draft);
    return;
  }

  if (event.type === "match.ended") {
    const payload = event.payload as unknown as MatchEndedPayload;
    const id = await draftId(event.roomId, payload.matchIndex, viewerMemberId);
    const draft = await statsDb.drafts.get(id);
    if (!draft || draft.kind !== "multiplayer") return;
    const isRelay = draft.multiplayerMode === "relay";
    const scoreRows =
      isRelay && payload.relay ? payload.relay.standings : payload.scores;
    const ranking =
      isRelay && payload.relay ? payload.relay.ranking : payload.ranking;
    const scoreSelf = scoreForMemberId(scoreRows, identity);
    const opponentScores = scoreRows
      .filter((score) => score.memberId !== identity)
      .sort((a, b) => a.seat - b.seat)
      .map((score) => score.score);
    const durationMs = draft.rounds.reduce(
      (sum, round) => sum + round.durationMs,
      0,
    );
    const viewerRanking = ranking?.find((entry) => entry.memberId === identity);
    const raceViewerRanking = payload.ranking?.find(
      (entry) => entry.memberId === identity,
    );
    const relayViewerRanking = payload.relay?.ranking.find(
      (entry) => entry.memberId === identity,
    );
    const tiedForFirst = Boolean(
      viewerRanking?.rank === 1 &&
      ranking &&
      ranking.filter((entry) => entry.rank === 1).length > 1,
    );
    const record = {
      id,
      schemaVersion: STATS_SCHEMA_VERSION,
      kind: "multiplayer" as const,
      mode: "multiplayer" as const,
      format: draft.format,
      multiplayerMode: draft.multiplayerMode ?? "race",
      matchIndex: payload.matchIndex,
      startedAt: draft.startedAt,
      endedAt: event.occurredAt,
      durationMs,
      outcome: outcomeForMatch(payload, viewerMemberId),
      difficulty: draft.difficulty ?? "unknown",
      reason: payload.reason,
      scoreSelf,
      opponentScores,
      rosterSize: draft.rosterSize ?? scoreRows.length,
      playerLimit: draft.playerLimit ?? draft.rosterSize ?? scoreRows.length,
      ruleSetKey:
        draft.ruleSetKey ??
        (draft.multiplayerMode === "relay"
          ? "legacy_wins"
          : (draft.scoringMode ?? "wins")),
      ruleSetVersion: draft.ruleSetVersion ?? 1,
      ...(draft.multiplayerMode === "relay"
        ? {}
        : { scoringMode: draft.scoringMode ?? "wins" }),
      finalRank: viewerRanking?.rank,
      tiedForFirst,
      eliminatedRound: isRelay ? undefined : raceViewerRanking?.eliminatedRound,
      eliminatedStage: isRelay
        ? relayViewerRanking?.eliminatedStage
        : undefined,
      survivedStages: isRelay ? relayViewerRanking?.survivedStages : undefined,
      rounds: draft.rounds,
      ...(isRelay ? { relayStages: draft.relayStages ?? [] } : {}),
    };
    assertStatsPrivacy(record);
    await statsDb.transaction(
      "rw",
      statsDb.records,
      statsDb.drafts,
      statsDb.metadata,
      async () => {
        const clearedAt = await statsDb.metadata.get("clearedAt");
        if (
          typeof clearedAt?.value !== "string" ||
          Date.parse(event.occurredAt) > Date.parse(clearedAt.value)
        ) {
          await statsDb.records.put(record);
        }
        await statsDb.drafts.delete(id);
      },
    );
  }
}

export async function migrateLegacyMultiplayerDraft(
  roomId: string,
  matchIndex: number,
  legacySeat: 1 | 2,
  viewerMemberId: string,
): Promise<void> {
  const oldId = await stableRecordId(
    `multi:${roomId}:${matchIndex}:${legacySeat}`,
  );
  const draft = await statsDb.drafts.get(oldId);
  if (!draft || draft.kind !== "multiplayer") return;
  const id = await draftId(roomId, matchIndex, viewerMemberId);
  const current = await statsDb.drafts.get(id);
  const currentDraft = current?.kind === "multiplayer" ? current : undefined;
  const rounds = new Map(
    (currentDraft?.rounds ?? []).map((round) => [round.roundIndex, round]),
  );
  for (const round of draft.rounds) rounds.set(round.roundIndex, round);
  const currentActive = currentDraft?.activeRound;
  const legacyActive = draft.activeRound;
  const activeRound =
    currentActive &&
    legacyActive &&
    currentActive.roundIndex === legacyActive.roundIndex
      ? {
          ...currentActive,
          activeElapsedMs: Math.max(
            currentActive.activeElapsedMs,
            legacyActive.activeElapsedMs,
          ),
          guessCompletedElapsedMs:
            legacyActive.guessCompletedElapsedMs.length >=
            currentActive.guessCompletedElapsedMs.length
              ? legacyActive.guessCompletedElapsedMs
              : currentActive.guessCompletedElapsedMs,
        }
      : (legacyActive ?? currentActive);
  const migrated: MultiplayerStatsDraft = {
    ...currentDraft,
    ...draft,
    id,
    sourceKey: await roomSourceKey(roomId, viewerMemberId),
    playerLimit: currentDraft?.playerLimit ?? draft.playerLimit,
    rounds: [...rounds.values()].sort(
      (left, right) => left.roundIndex - right.roundIndex,
    ),
    activeRound,
  };
  delete migrated.memberSlot;
  await statsDb.transaction("rw", statsDb.drafts, async () => {
    await statsDb.drafts.put(migrated);
    await statsDb.drafts.delete(oldId);
  });
}

export async function loadMultiplayerTiming(
  roomId: string,
  matchIndex: number,
  viewerMemberId: string,
): Promise<MultiplayerTimingSnapshot | undefined> {
  const draft = await statsDb.drafts.get(
    await draftId(roomId, matchIndex, viewerMemberId),
  );
  if (!draft || draft.kind !== "multiplayer") return undefined;
  const active =
    draft.multiplayerMode === "relay"
      ? draft.activeRelayStage
      : draft.activeRound;
  if (!active || ("assignment" in active && active.assignment === "bye")) {
    return undefined;
  }
  return {
    activeElapsedMs: active.activeElapsedMs,
    guessCompletedElapsedMs: active.guessCompletedElapsedMs,
  };
}

export async function updateMultiplayerTiming(
  roomId: string,
  matchIndex: number,
  viewerMemberId: string,
  timing: MultiplayerTimingSnapshot,
): Promise<void> {
  const id = await draftId(roomId, matchIndex, viewerMemberId);
  const draft = await statsDb.drafts.get(id);
  if (!draft || draft.kind !== "multiplayer") return;
  const active =
    draft.multiplayerMode === "relay"
      ? draft.activeRelayStage
      : draft.activeRound;
  if (!active || ("assignment" in active && active.assignment === "bye")) {
    return;
  }
  active.activeElapsedMs = timing.activeElapsedMs;
  active.guessCompletedElapsedMs = timing.guessCompletedElapsedMs;
  draft.updatedAt = new Date().toISOString();
  await putStatsDraft(draft);
}

export async function markMultiplayerDraftIncomplete(
  roomId: string,
  viewerMemberId: string,
): Promise<void> {
  const sourceKey = await roomSourceKey(roomId, viewerMemberId);
  const draft = (
    await statsDb.drafts.where("kind").equals("multiplayer").toArray()
  ).find(
    (entry) => entry.kind === "multiplayer" && entry.sourceKey === sourceKey,
  ) as MultiplayerStatsDraft | undefined;
  if (!draft) return;
  draft.incomplete = true;
  draft.updatedAt = new Date().toISOString();
  await putStatsDraft(draft);
}
