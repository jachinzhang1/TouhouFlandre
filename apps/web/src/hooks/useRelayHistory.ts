"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RelayAnswerView,
  RelayEncounterView,
  RelayStageView,
} from "@touhouflandre/shared";
import type { components } from "../generated/api";
import { api } from "../lib/api";

type RelayStageHistoryView = components["schemas"]["RelayStageHistoryView"];

export interface RelayHistoryState {
  stagesByIndex: Readonly<Record<number, RelayStageView>>;
  loadingStageIndex: number | null;
  errorByStageIndex: Readonly<Record<number, string>>;
}

export function useRelayHistory(
  roomId: string,
  token: string,
  matchIndex: number | undefined,
) {
  const [state, setState] = useState<RelayHistoryState>({
    stagesByIndex: {},
    loadingStageIndex: null,
    errorByStageIndex: {},
  });
  const stateRef = useRef(state);
  const cursorRef = useRef<string | undefined>(undefined);
  const exhaustedRef = useRef(false);
  const inFlightRef = useRef(new Map<number, Promise<void>>());
  stateRef.current = state;

  useEffect(() => {
    const empty: RelayHistoryState = {
      stagesByIndex: {},
      loadingStageIndex: null,
      errorByStageIndex: {},
    };
    cursorRef.current = undefined;
    exhaustedRef.current = false;
    inFlightRef.current.clear();
    stateRef.current = empty;
    setState(empty);
  }, [matchIndex, roomId]);

  const loadStage = useCallback(
    (stageIndex: number, force = false): Promise<void> => {
      if (!roomId || !token || matchIndex === undefined || stageIndex < 1) {
        return Promise.resolve();
      }
      if (!force && stateRef.current.stagesByIndex[stageIndex]) {
        return Promise.resolve();
      }
      const existing = inFlightRef.current.get(stageIndex);
      if (existing) return existing;

      const request = (async () => {
        setState((current) => ({
          ...current,
          loadingStageIndex: stageIndex,
          errorByStageIndex: Object.fromEntries(
            Object.entries(current.errorByStageIndex).filter(
              ([key]) => Number(key) !== stageIndex,
            ),
          ),
        }));
        try {
          while (
            !stateRef.current.stagesByIndex[stageIndex] &&
            !exhaustedRef.current
          ) {
            const page = await api.listRelayStageHistory(
              roomId,
              token,
              matchIndex,
              { after: cursorRef.current, limit: 20 },
            );
            const additions = Object.fromEntries(
              page.stages.map((stage: RelayStageHistoryView) => [
                stage.stageIndex,
                historyStageToProjection(stage),
              ]),
            );
            setState((current) => {
              const next = {
                ...current,
                stagesByIndex: { ...current.stagesByIndex, ...additions },
              };
              stateRef.current = next;
              return next;
            });
            cursorRef.current = page.nextCursor;
            exhaustedRef.current = !page.nextCursor;
            if (page.stages.length === 0) exhaustedRef.current = true;
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "历史棋盘加载失败。";
          setState((current) => ({
            ...current,
            errorByStageIndex: {
              ...current.errorByStageIndex,
              [stageIndex]: message,
            },
          }));
        } finally {
          setState((current) => ({
            ...current,
            loadingStageIndex:
              current.loadingStageIndex === stageIndex
                ? null
                : current.loadingStageIndex,
          }));
          inFlightRef.current.delete(stageIndex);
        }
      })();
      inFlightRef.current.set(stageIndex, request);
      return request;
    },
    [matchIndex, roomId, token],
  );

  return {
    ...state,
    loadStage,
    retryStage: (stageIndex: number) => loadStage(stageIndex, true),
  };
}

function historyStageToProjection(
  stage: RelayStageHistoryView,
): RelayStageView {
  return {
    stageId: stage.stageId,
    stageIndex: stage.stageIndex,
    status: "ended",
    encounters: stage.encounters.map((encounter) => ({
      encounterId: encounter.encounterId,
      encounterIndex: encounter.encounterIndex,
      status: "ended",
      members: encounter.members,
    })),
    encounterDetails: stage.encounters.map(
      (encounter) =>
        ({
          ...encounter,
          status: "ended",
          answer: historyAnswer(encounter.answer),
        }) as unknown as RelayEncounterView,
    ),
    byeMemberId: stage.byeMemberId,
    settlement: stage.settlement,
  };
}

function historyAnswer(
  answer: components["schemas"]["Character"],
): RelayAnswerView {
  const mainlineIndex = answer.firstAppearance.mainlineIndex;
  return {
    id: answer.id,
    name: answer.names.zhHans,
    avatarUrl: answer.avatarUrl,
    workId: answer.firstAppearance.workId,
    workTitle: answer.firstAppearance.workTitle,
    workCode: Number.isFinite(mainlineIndex)
      ? `TH${String(mainlineIndex).padStart(2, "0")}`
      : answer.firstAppearance.workId.toUpperCase(),
  };
}
