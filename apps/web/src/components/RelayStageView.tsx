"use client";

import { FastForward, Flag } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  GuessField,
  MatchEndedPayload,
  RelayEncounterView,
} from "@touhouflandre/shared";
import type { components } from "../generated/api";
import type { RoomActions } from "../hooks/useRoom";
import { useRelayHistory } from "../hooks/useRelayHistory";
import type { RelayProjectionState } from "../domain/relayProjection";
import {
  currentRelayStage,
  normalizeCurrentRelaySelection,
  orderedRelayEncounters,
  relayActionCapability,
  relaySkipUsage,
  selectRelayView,
  type RelayViewSelection,
} from "../domain/relayView";
import { ROOM_FORMAT_SHORT } from "../domain/multiRoom";
import { formatRemaining, useRoomClock } from "../hooks/useRoomClock";
import {
  BoardBrowser,
  BoardViewport,
  MatchCountdownBand,
  MatchFinishedBand,
  MatchStatusBand,
  MatchSummaryBar,
  MultiplayerMatchFrame,
} from "../multiplayer/framework";
import { GuessInputBar } from "./game/GuessInputBar";
import type { MemberScoreStripEntry } from "./multiplayer/MemberScoreStrip";
import {
  RelayEncounterBoard,
  relayEncounterTitle,
} from "./RelayEncounterBoard";

type MemberView = components["schemas"]["MemberView"];
type ParticipantView = components["schemas"]["ParticipantView"];

export function RelayStageView({
  roomId,
  token,
  format,
  projection,
  members,
  viewer,
  fields,
  roomStatus,
  retentionEndsAt,
  matchResult,
  rematchReady,
  actions,
  onRematch,
  onLeave,
}: {
  roomId: string;
  token: string;
  format: string;
  projection: RelayProjectionState;
  members: readonly MemberView[];
  viewer: ParticipantView;
  fields: readonly GuessField[];
  roomStatus: string;
  retentionEndsAt?: string | null;
  matchResult: MatchEndedPayload | null;
  rematchReady: Array<{ memberId: string; seat: number; ready: boolean }>;
  actions: RoomActions;
  onRematch: () => void;
  onLeave: () => void;
}) {
  const selectionKey = `touhouflandre:relay-view:${roomId}:${projection.matchIndex}`;
  const [selection, setSelection] = useState<RelayViewSelection>({
    scope: "current",
  });
  const [restoredSelectionKey, setRestoredSelectionKey] = useState<
    string | null
  >(null);
  const [actionBusy, setActionBusy] = useState<"pass" | "forfeit" | null>(null);
  const [forfeitConfirm, setForfeitConfirm] = useState(false);
  const history = useRelayHistory(roomId, token, projection.matchIndex);
  const projectedCurrentStage = currentRelayStage(projection);
  const projectedStageStartsAt =
    projectedCurrentStage?.startsAt ??
    projectedCurrentStage?.encounterDetails?.[0]?.startsAt;
  const previousStage = projectedCurrentStage
    ? projection.stagesByIndex[projectedCurrentStage.stageIndex - 1]
    : undefined;
  const stageHasStarted = Boolean(
    (projectedCurrentStage && projectedCurrentStage.status !== "planned") ||
    projectedCurrentStage?.encounters.some(
      (encounter) =>
        encounter.status === "playing" || encounter.status === "ended",
    ),
  );
  const isInitialStageCountdown = Boolean(
    projectedStageStartsAt &&
    projectedCurrentStage?.stageIndex === 1 &&
    !previousStage &&
    !stageHasStarted,
  );
  const isStageIntermission = Boolean(
    projectedStageStartsAt &&
    previousStage?.status === "ended" &&
    !stageHasStarted,
  );
  const intermissionStage = previousStage
    ? (history.stagesByIndex[previousStage.stageIndex] ?? previousStage)
    : undefined;
  const currentStage = isStageIntermission
    ? intermissionStage
    : projectedCurrentStage;
  const visibleProjection = isStageIntermission
    ? {
        ...projection,
        currentStageIndex: intermissionStage?.stageIndex,
        stagesByIndex: intermissionStage
          ? {
              ...projection.stagesByIndex,
              [intermissionStage.stageIndex]: intermissionStage,
            }
          : projection.stagesByIndex,
      }
    : projection;

  useEffect(() => {
    let restored: RelayViewSelection = { scope: "current" };
    try {
      const stored = window.sessionStorage.getItem(selectionKey);
      if (stored) {
        const parsed = JSON.parse(stored) as RelayViewSelection;
        if (parsed.scope === "current" || parsed.scope === "history") {
          restored = parsed;
        }
      }
    } catch {
      window.sessionStorage.removeItem(selectionKey);
    } finally {
      setSelection(restored);
      setRestoredSelectionKey(selectionKey);
    }
  }, [selectionKey]);

  useEffect(() => {
    if (restoredSelectionKey !== selectionKey) return;
    window.sessionStorage.setItem(selectionKey, JSON.stringify(selection));
  }, [restoredSelectionKey, selection, selectionKey]);

  useEffect(() => {
    if (restoredSelectionKey !== selectionKey || !currentStage) {
      return;
    }
    setSelection((current) =>
      normalizeCurrentRelaySelection(current, currentStage, viewer.memberId),
    );
  }, [currentStage, restoredSelectionKey, selectionKey, viewer.memberId]);

  useEffect(() => {
    if (selection.scope !== "history" || !selection.stageIndex) return;
    void history.loadStage(selection.stageIndex);
  }, [history.loadStage, selection.scope, selection.stageIndex]);

  useEffect(() => {
    if (
      !isStageIntermission ||
      !previousStage ||
      previousStage.encounterDetails?.length
    ) {
      return;
    }
    void history.loadStage(previousStage.stageIndex);
  }, [history.loadStage, isStageIntermission, previousStage]);

  useEffect(() => {
    setForfeitConfirm(false);
    setActionBusy(null);
  }, [selection.encounterId, selection.scope, selection.stageIndex]);

  useEffect(() => {
    if (!forfeitConfirm) return;
    const timeout = window.setTimeout(() => setForfeitConfirm(false), 4000);
    return () => window.clearTimeout(timeout);
  }, [forfeitConfirm]);

  const selected = selectRelayView(
    visibleProjection,
    selection,
    history.stagesByIndex,
  );
  const navigationStage =
    selected.stage ??
    (selection.stageIndex === undefined
      ? currentStage
      : projection.stagesByIndex[selection.stageIndex]);
  const navigationByeMemberId =
    selection.scope === "history"
      ? navigationStage?.byeMemberId
      : (projectedCurrentStage?.byeMemberId ?? navigationStage?.byeMemberId);
  const navigationEncounters = orderedRelayEncounters(navigationStage);
  const historyStages = Object.values(projection.stagesByIndex)
    .filter((stage) => stage.status === "ended")
    .sort((left, right) => left.stageIndex - right.stageIndex);
  const scoreEntries = relayScoreEntries(
    projection,
    members,
    projectedCurrentStage?.byeMemberId,
  );
  const skips = relaySkipUsage(selected.ownEncounter, viewer.memberId);
  const isCurrent = selection.scope === "current";
  const canGuess = isCurrent && relayActionCapability(selected, "guess");
  const canPass =
    isCurrent && skips.remaining > 0 && relayActionCapability(selected, "pass");
  const canForfeit = isCurrent && relayActionCapability(selected, "forfeit");
  const actionTarget =
    selected.isSelectedOwnEncounter && selected.stage && selected.ownEncounter
      ? {
          stageIndex: selected.stage.stageIndex,
          encounterId: selected.ownEncounter.encounterId,
        }
      : null;
  const statusMessage = relayStatusMessage(
    selected,
    projection,
    members,
    viewer,
    selection.scope,
  );
  const retentionRemaining = useRoomClock(
    roomStatus === "finished" ? (retentionEndsAt ?? null) : null,
  );
  const guessedIds = new Set(
    (selected.ownEncounter?.rows ?? []).flatMap((row) =>
      row.kind === "guess" && row.guess ? [row.guess.guessId] : [],
    ),
  );

  const act = async (action: "pass" | "forfeit") => {
    if (!actionTarget) return;
    setActionBusy(action);
    try {
      await actions.relayEncounterAction(actionTarget, action);
    } finally {
      setActionBusy(null);
    }
  };

  const persistSelection = (next: RelayViewSelection) => {
    window.sessionStorage.setItem(selectionKey, JSON.stringify(next));
    setSelection(next);
  };

  const selectEncounter = (encounterId: string) => {
    persistSelection({ ...selection, encounterId });
  };

  const selectCurrent = () => {
    persistSelection({
      scope: "current",
      stageIndex: currentStage?.stageIndex,
      encounterId:
        currentStage?.encounterDetails?.find((encounter) =>
          encounter.members.some(
            (member) => member.memberId === viewer.memberId,
          ),
        )?.encounterId ?? currentStage?.encounterDetails?.[0]?.encounterId,
    });
  };

  const selectHistory = (stageIndex: number) => {
    const summary = projection.stagesByIndex[stageIndex];
    const own = summary?.encounters.find((encounter) =>
      encounter.members.some((member) => member.memberId === viewer.memberId),
    );
    persistSelection({
      scope: "history",
      stageIndex,
      encounterId: own?.encounterId ?? summary?.encounters[0]?.encounterId,
    });
  };

  const ready = rematchReady.some(
    (candidate) => candidate.memberId === viewer.memberId && candidate.ready,
  );
  const readyCount = rematchReady.filter((candidate) => candidate.ready).length;
  const matchFinished =
    roomStatus === "finished" && projection.ranking.length > 0;
  const statusActions =
    viewer.role === "player" && selected.ownEncounter && isCurrent ? (
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-paper-muted px-2 py-1 text-[0.7rem] font-bold text-ink-soft">
          空过 {skips.used}/{skips.maximum} · 剩余 {skips.remaining}
        </span>
        <button
          type="button"
          title={skips.remaining > 0 ? "主动空过本手" : "本局空过次数已用完"}
          onClick={() => void act("pass")}
          disabled={!canPass || actionBusy !== null}
          className="inline-flex size-8 items-center justify-center rounded-[5px] border border-line-strong bg-paper-muted text-ink-soft disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="主动空过本手"
        >
          <FastForward size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          title={forfeitConfirm ? "再次点击确认放弃本局" : "放弃本局"}
          onClick={() => {
            if (!forfeitConfirm) {
              setForfeitConfirm(true);
              return;
            }
            setForfeitConfirm(false);
            void act("forfeit");
          }}
          disabled={!canForfeit || actionBusy !== null}
          className={`inline-flex size-8 items-center justify-center rounded-[5px] border disabled:cursor-not-allowed disabled:opacity-40 ${forfeitConfirm ? "border-vermilion bg-vermilion-soft text-vermilion" : "border-line-strong bg-paper-muted text-ink-soft"}`}
          aria-label={forfeitConfirm ? "再次点击确认放弃本局" : "放弃本局"}
        >
          <Flag size={15} aria-hidden="true" />
        </button>
      </div>
    ) : undefined;

  return (
    <div data-relay-stage-view>
      <MultiplayerMatchFrame
        bottomDock={
          viewer.role === "player" &&
          selected.ownEncounter?.status === "playing" &&
          selected.standing?.status === "active" &&
          isCurrent ? (
            <GuessInputBar
              onGuess={(guessId) => {
                if (!canGuess || !actionTarget) return Promise.resolve(false);
                return actions.relayEncounterAction(
                  actionTarget,
                  "guess",
                  guessId,
                );
              }}
              disabled={!canGuess}
              searchContext={{
                kind: "multiplayer-match",
                roomId,
                matchIndex: projection.matchIndex,
              }}
              guessedIds={guessedIds}
              statusMessage={!canGuess ? statusMessage : null}
            />
          ) : undefined
        }
      >
        <MatchSummaryBar
          model={{
            identityLabel: `接力 · ${ruleSetLabel(projection.ruleSetRef.key)} · ${ROOM_FORMAT_SHORT[format as keyof typeof ROOM_FORMAT_SHORT] ?? format}`,
            scoreEntries,
            progressLabel: currentStage
              ? `第 ${currentStage.stageIndex}${projection.plannedStages ? `/${projection.plannedStages}` : ""} 轮`
              : "等待轮次",
          }}
        />

        {isInitialStageCountdown || isStageIntermission ? (
          <div
            data-relay-stage-countdown
            data-relay-intermission={isStageIntermission ? "" : undefined}
            data-relay-initial-countdown={
              isInitialStageCountdown ? "" : undefined
            }
          >
            <MatchCountdownBand
              targetAt={projectedStageStartsAt!}
              label={isInitialStageCountdown ? "对局" : "下一局"}
              kind={isInitialStageCountdown ? "initial" : "intermission"}
            />
          </div>
        ) : null}

        {matchFinished ? (
          <MatchFinishedBand
            ranking={projection.ranking.map((entry) => {
              const name =
                members.find((member) => member.memberId === entry.memberId)
                  ?.displayName ?? "玩家";
              const suffix =
                entry.memberId === viewer.memberId ? "我" : `P${entry.seat}`;
              return {
                id: entry.memberId,
                rank: entry.rank,
                label: `${name}(${suffix})`,
                scoreLabel: `${entry.score} 分${entry.survivedStages !== undefined ? ` · 存留 ${entry.survivedStages} 轮` : ""}`,
                isViewer: entry.memberId === viewer.memberId,
              };
            })}
            subtitle={`房间保留 ${formatRemaining(retentionRemaining)}`}
            ready={ready}
            readyLabel={ready ? `已确认 ${readyCount}` : "再来一局"}
            onRematch={onRematch}
            onLeave={onLeave}
          />
        ) : null}

        {!matchFinished ? (
          <div data-relay-status>
            <MatchStatusBand
              model={{
                message: statusMessage,
                active: canGuess,
                timers:
                  isCurrent && selected.encounter?.status === "playing"
                    ? [
                        {
                          label: "本手",
                          deadline: selected.encounter.turnDeadline,
                        },
                        {
                          label: "本局",
                          deadline: selected.encounter.deadline,
                        },
                      ]
                    : undefined,
              }}
              actions={statusActions}
            />
          </div>
        ) : null}

        <BoardBrowser
          model={{
            ariaLabel: "接力棋盘导航",
            returnLabel: "返回当前轮",
            currentScopeId: "current",
            selectedScopeId:
              selection.scope === "history" && selection.stageIndex
                ? `history:${selection.stageIndex}`
                : "current",
            scopeLabel: "选择轮次",
            scopeOptions: [
              { id: "current", label: "当前轮" },
              ...historyStages.map((stage) => ({
                id: `history:${stage.stageIndex}`,
                label: `第 ${stage.stageIndex} 轮`,
              })),
            ],
            boardLabel: "选择对局",
            selectedBoardId: selection.encounterId,
            boardOptions: navigationEncounters.map((encounter) => ({
              id: encounter.encounterId,
              label: relayEncounterTitle(encounter, members),
            })),
            trailing: navigationByeMemberId ? (
              <span className="rounded bg-jade-soft px-2 py-1 text-[0.7rem] font-bold text-jade">
                本轮有轮空
              </span>
            ) : undefined,
          }}
          onScopeChange={(scopeId) => {
            if (scopeId === "current") selectCurrent();
            else selectHistory(Number(scopeId.slice("history:".length)));
          }}
          onBoardChange={selectEncounter}
        />

        <BoardViewport
          state={
            selection.scope === "history" &&
            selection.stageIndex &&
            history.loadingStageIndex === selection.stageIndex &&
            !selected.encounter
              ? { status: "loading", message: "历史棋盘加载中……" }
              : selection.scope === "history" &&
                  selection.stageIndex &&
                  history.errorByStageIndex[selection.stageIndex] &&
                  !selected.encounter
                ? {
                    status: "error",
                    message: history.errorByStageIndex[selection.stageIndex],
                    onRetry: () =>
                      void history.retryStage(selection.stageIndex!),
                  }
                : selected.encounter
                  ? {
                      status: "ready",
                      content: (
                        <RelayEncounterBoard
                          encounter={selected.encounter}
                          members={members}
                          fields={fields}
                        />
                      ),
                    }
                  : {
                      status: "empty",
                      message:
                        currentStage?.byeMemberId === viewer.memberId
                          ? "本轮轮空，可以浏览其他对局。"
                          : "等待棋盘同步。",
                    }
          }
        />
      </MultiplayerMatchFrame>
    </div>
  );
}

function relayScoreEntries(
  projection: RelayProjectionState,
  members: readonly MemberView[],
  byeMemberId?: string,
): MemberScoreStripEntry[] {
  const rankCounts = new Map<number, number>();
  for (const ranking of projection.ranking) {
    rankCounts.set(ranking.rank, (rankCounts.get(ranking.rank) ?? 0) + 1);
  }
  return projection.standings.map((standing) => {
    const member = members.find(
      (candidate) => candidate.memberId === standing.memberId,
    );
    const ranking = projection.ranking.find(
      (candidate) => candidate.memberId === standing.memberId,
    );
    const labels = [
      ...(standing.status === "eliminated" ? ["已淘汰"] : []),
      ...(standing.status === "left" ? ["已离场"] : []),
      ...(standing.status !== "eliminated" &&
      standing.lifeState === "near_death"
        ? ["濒死"]
        : []),
      ...(standing.memberId === byeMemberId ? ["轮空"] : []),
      ...(member?.status === "disconnected" ? ["离线"] : []),
      ...(ranking
        ? [
            `${(rankCounts.get(ranking.rank) ?? 0) > 1 ? "并列" : ""}第 ${ranking.rank} 名`,
          ]
        : []),
    ];
    return {
      memberId: standing.memberId,
      seat: standing.seat,
      displayName: member?.displayName ?? "玩家",
      score: standing.score,
      isViewer: standing.memberId === projection.viewerMemberId,
      isWinner: ranking?.rank === 1 && rankCounts.get(1) === 1,
      tone:
        standing.status === "eliminated"
          ? "danger"
          : standing.lifeState === "near_death"
            ? "warning"
            : ranking?.rank === 1
              ? "success"
              : standing.memberId === projection.viewerMemberId
                ? "accent"
                : "default",
      statusLabels: labels,
    };
  });
}

function relayStatusMessage(
  selected: ReturnType<typeof selectRelayView>,
  projection: RelayProjectionState,
  members: readonly MemberView[],
  viewer: ParticipantView,
  scope: "current" | "history",
): string {
  if (scope === "history") {
    return selected.stage
      ? `正在查看第 ${selected.stage.stageIndex} 轮历史`
      : "历史棋盘加载中";
  }
  if (!selected.stage) return "等待当前轮同步";
  if (selected.standing?.status === "left") return "你已离场，当前为只读视图";
  if (selected.standing?.status === "eliminated")
    return "你已淘汰，可以继续浏览所有棋盘";
  if (selected.isBye) return "你本轮轮空，可以浏览其他对局";
  if (viewer.role === "spectator") return "只读观战，可以浏览所有对局";
  if (!selected.isSelectedOwnEncounter) return "正在浏览其他对局，操作已禁用";
  const encounter = selected.ownEncounter;
  if (!encounter) return "等待配对";
  if (encounter.status === "ended") {
    const result = encounterResultMessage(encounter, viewer.memberId);
    return selected.stage.status === "ended"
      ? result
      : `${result}，等待其他棋盘完成`;
  }
  if (encounter.turnMemberId === viewer.memberId) return "轮到你操作";
  const turnMember = members.find(
    (member) => member.memberId === encounter.turnMemberId,
  );
  return turnMember
    ? `等待 ${turnMember.displayName}(P${turnMember.seat}) 操作`
    : "等待对手操作";
}

function encounterResultMessage(
  encounter: RelayEncounterView,
  viewerMemberId: string,
): string {
  if (encounter.winnerMemberId === viewerMemberId) {
    if (encounter.outcome === "forfeit") return "对手已放弃，本局获胜";
    if (encounter.outcome === "timeout") return "对手已超时，本局获胜";
    return "你已猜中本局";
  }
  if (encounter.winnerMemberId) {
    if (encounter.outcome === "forfeit") return "你已放弃本局";
    if (encounter.outcome === "timeout") return "你已超时，本局失利";
    return "对手已猜中本局";
  }
  return "本局平局";
}

function ruleSetLabel(key: string): string {
  if (key === "legacy_wins") return "传统双人";
  if (key === "fixed_points") return "固定积分";
  if (key === "elimination") return "淘汰赛";
  return key;
}
