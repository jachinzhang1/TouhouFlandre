"use client";

import {
  ChevronLeft,
  ChevronRight,
  FastForward,
  Flag,
  History,
  RotateCcw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  GuessField,
  MatchEndedPayload,
  RelayEncounterView,
  RelayRankingView,
  RelayStageView,
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
import { GuessInputBar } from "./GuessInputBar";
import {
  MemberScoreStrip,
  type MemberScoreStripEntry,
} from "./MemberScoreStrip";
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
  catalogVersion,
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
  catalogVersion?: string;
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
  const nextStageRemaining = useRoomClock(projectedStageStartsAt ?? null);
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
  const navigationEncounters = orderedRelayEncounters(navigationStage);
  const selectedEncounterIndex = Math.max(
    0,
    navigationEncounters.findIndex(
      (encounter) => encounter.encounterId === selection.encounterId,
    ),
  );
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
  const turnRemaining = useRoomClock(
    isCurrent ? (selected.encounter?.turnDeadline ?? null) : null,
  );
  const encounterRemaining = useRoomClock(
    isCurrent ? (selected.encounter?.deadline ?? null) : null,
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

  return (
    <section className="px-[18px] pt-4 pb-28" data-relay-stage-view>
      <div className="mx-auto max-w-[1280px]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-y border-line bg-paper px-3 py-2.5">
          <span className="rounded bg-vermilion-soft px-2 py-0.5 text-[0.72rem] font-black text-vermilion">
            接力 · {ruleSetLabel(projection.ruleSetRef.key)} ·{" "}
            {ROOM_FORMAT_SHORT[format as keyof typeof ROOM_FORMAT_SHORT] ??
              format}
          </span>
          <MemberScoreStrip entries={scoreEntries} />
          <span className="text-[0.72rem] text-ink-soft tabular-nums">
            {currentStage
              ? `第 ${currentStage.stageIndex}${projection.plannedStages ? `/${projection.plannedStages}` : ""} 轮`
              : "等待轮次"}
          </span>
        </div>

        {isInitialStageCountdown || isStageIntermission ? (
          <div
            className="relay-next-stage-countdown mb-3 flex min-h-14 items-center justify-center border-y border-amber bg-paper px-3 py-2.5 text-center"
            data-relay-stage-countdown
            data-relay-intermission={isStageIntermission ? "" : undefined}
            data-relay-initial-countdown={
              isInitialStageCountdown ? "" : undefined
            }
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <p className="m-0 text-[0.9rem] font-black text-amber tabular-nums">
              {nextStageRemaining > 0
                ? `${isInitialStageCountdown ? "对局" : "下一局"}将于 ${Math.ceil(nextStageRemaining / 1000)} 秒后开始…`
                : `${isInitialStageCountdown ? "对局" : "下一局"}即将开始…`}
            </p>
          </div>
        ) : null}

        {roomStatus === "finished" && projection.ranking.length > 0 ? (
          <RelayFinishedBand
            ranking={projection.ranking}
            members={members}
            viewerMemberId={viewer.memberId}
            ready={rematchReady.some(
              (candidate) =>
                candidate.memberId === viewer.memberId && candidate.ready,
            )}
            readyCount={
              rematchReady.filter((candidate) => candidate.ready).length
            }
            retention={formatRemaining(retentionRemaining)}
            onRematch={onRematch}
            onLeave={onLeave}
          />
        ) : null}

        <div
          className={`mb-3 flex min-h-14 flex-wrap items-center justify-between gap-3 border-y border-line bg-paper px-3 py-2.5 ${canGuess ? "relay-current-turn-active" : ""}`}
          data-relay-status
          role="status"
          aria-live="polite"
        >
          <div className="min-w-0">
            <p className="m-0 text-[0.82rem] font-bold text-ink">
              {statusMessage}
            </p>
            {isCurrent && selected.encounter?.status === "playing" ? (
              <p className="mt-1 mb-0 text-[0.7rem] text-ink-soft tabular-nums">
                本手 {formatRemaining(turnRemaining)} · 本局{" "}
                {formatRemaining(encounterRemaining)}
              </p>
            ) : null}
          </div>
          {viewer.role === "player" && selected.ownEncounter && isCurrent ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-paper-muted px-2 py-1 text-[0.7rem] font-bold text-ink-soft">
                空过 {skips.used}/{skips.maximum} · 剩余 {skips.remaining}
              </span>
              <button
                type="button"
                title={
                  skips.remaining > 0 ? "主动空过本手" : "本局空过次数已用完"
                }
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
                aria-label={
                  forfeitConfirm ? "再次点击确认放弃本局" : "放弃本局"
                }
              >
                <Flag size={15} aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </div>

        <RelayNavigator
          stage={navigationStage}
          encounters={navigationEncounters}
          selectedEncounterIndex={selectedEncounterIndex}
          selectedEncounterId={selection.encounterId}
          historyStages={historyStages}
          selection={selection}
          members={members}
          onCurrent={() =>
            persistSelection({
              scope: "current",
              stageIndex: currentStage?.stageIndex,
              encounterId:
                currentStage?.encounterDetails?.find((encounter) =>
                  encounter.members.some(
                    (member) => member.memberId === viewer.memberId,
                  ),
                )?.encounterId ??
                currentStage?.encounterDetails?.[0]?.encounterId,
            })
          }
          onHistory={(stageIndex) => {
            const summary = projection.stagesByIndex[stageIndex];
            const own = summary?.encounters.find((encounter) =>
              encounter.members.some(
                (member) => member.memberId === viewer.memberId,
              ),
            );
            persistSelection({
              scope: "history",
              stageIndex,
              encounterId:
                own?.encounterId ?? summary?.encounters[0]?.encounterId,
            });
          }}
          onEncounter={selectEncounter}
        />

        {selection.scope === "history" &&
        selection.stageIndex &&
        history.loadingStageIndex === selection.stageIndex &&
        !selected.encounter ? (
          <div
            className="min-h-[360px] py-20 text-center text-ink-soft"
            role="status"
          >
            历史棋盘加载中……
          </div>
        ) : selection.scope === "history" &&
          selection.stageIndex &&
          history.errorByStageIndex[selection.stageIndex] &&
          !selected.encounter ? (
          <div className="min-h-[260px] py-16 text-center" role="alert">
            <p className="text-vermilion">
              {history.errorByStageIndex[selection.stageIndex]}
            </p>
            <button
              type="button"
              className="rounded-[5px] border border-line-strong px-3 py-1.5 font-bold"
              onClick={() => void history.retryStage(selection.stageIndex!)}
            >
              重试
            </button>
          </div>
        ) : selected.encounter ? (
          <RelayEncounterBoard
            encounter={selected.encounter}
            members={members}
            fields={fields}
          />
        ) : (
          <div
            className="min-h-[260px] py-16 text-center text-ink-soft"
            role="status"
          >
            {currentStage?.byeMemberId === viewer.memberId
              ? "本轮轮空，可以浏览其他对局。"
              : "等待棋盘同步。"}
          </div>
        )}
      </div>

      {viewer.role === "player" &&
      selected.ownEncounter?.status === "playing" &&
      selected.standing?.status === "active" &&
      isCurrent ? (
        <GuessInputBar
          onGuess={(guessId) => {
            if (!canGuess || !actionTarget) return Promise.resolve();
            return actions.relayEncounterAction(actionTarget, "guess", guessId);
          }}
          disabled={!canGuess}
          catalogVersion={catalogVersion}
          guessedIds={guessedIds}
          statusMessage={!canGuess ? statusMessage : null}
        />
      ) : null}
    </section>
  );
}

function RelayNavigator({
  stage,
  encounters,
  selectedEncounterIndex,
  selectedEncounterId,
  historyStages,
  selection,
  members,
  onCurrent,
  onHistory,
  onEncounter,
}: {
  stage?: RelayStageView;
  encounters: RelayEncounterView[];
  selectedEncounterIndex: number;
  selectedEncounterId?: string;
  historyStages: RelayStageView[];
  selection: RelayViewSelection;
  members: readonly MemberView[];
  onCurrent: () => void;
  onHistory: (stageIndex: number) => void;
  onEncounter: (encounterId: string) => void;
}) {
  const selectedStageValue =
    selection.scope === "history" && selection.stageIndex
      ? String(selection.stageIndex)
      : "current";
  const move = (delta: number) => {
    const target = encounters[selectedEncounterIndex + delta];
    if (target) onEncounter(target.encounterId);
  };
  return (
    <nav
      className="mb-3 flex min-w-0 flex-wrap items-center gap-2 border-y border-line bg-paper-muted px-3 py-2"
      aria-label="接力棋盘导航"
    >
      <button
        type="button"
        onClick={onCurrent}
        aria-pressed={selection.scope === "current"}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-[5px] border border-line bg-paper px-2.5 text-[0.72rem] font-bold"
      >
        <RotateCcw size={14} aria-hidden="true" />
        返回当前轮
      </button>
      <label className="inline-flex min-w-0 items-center gap-1.5 text-[0.72rem] font-bold text-ink-soft">
        <History size={14} aria-hidden="true" />
        <span className="sr-only">选择轮次</span>
        <select
          aria-label="选择轮次"
          value={selectedStageValue}
          onChange={(event) => {
            if (event.target.value === "current") onCurrent();
            else onHistory(Number(event.target.value));
          }}
          className="min-h-8 max-w-40 rounded-[5px] border border-line bg-paper px-2 text-ink"
        >
          <option value="current">当前轮</option>
          {historyStages.map((historyStage) => (
            <option
              key={historyStage.stageIndex}
              value={historyStage.stageIndex}
            >
              第 {historyStage.stageIndex} 轮
            </option>
          ))}
        </select>
      </label>
      <label className="min-w-0 flex-1 text-[0.72rem] font-bold text-ink-soft max-[680px]:order-last max-[680px]:basis-full">
        <span className="sr-only">选择对局</span>
        <select
          aria-label="选择对局"
          value={selectedEncounterId ?? ""}
          disabled={encounters.length === 0}
          onChange={(event) => onEncounter(event.target.value)}
          className="min-h-8 w-full min-w-0 rounded-[5px] border border-line bg-paper px-2 text-ink"
        >
          {encounters.map((encounter) => (
            <option key={encounter.encounterId} value={encounter.encounterId}>
              {relayEncounterTitle(encounter, members)}
            </option>
          ))}
        </select>
      </label>
      <span className="min-w-16 text-center text-[0.72rem] text-ink-soft tabular-nums max-[680px]:min-w-10">
        {encounters.length ? selectedEncounterIndex + 1 : 0}/{encounters.length}
      </span>
      <button
        type="button"
        title="上一张棋盘"
        aria-label="上一张棋盘"
        disabled={selectedEncounterIndex <= 0 || encounters.length === 0}
        onClick={() => move(-1)}
        className="inline-flex size-8 items-center justify-center rounded-[5px] border border-line bg-paper disabled:opacity-40"
      >
        <ChevronLeft size={15} aria-hidden="true" />
      </button>
      <button
        type="button"
        title="下一张棋盘"
        aria-label="下一张棋盘"
        disabled={selectedEncounterIndex >= encounters.length - 1}
        onClick={() => move(1)}
        className="inline-flex size-8 items-center justify-center rounded-[5px] border border-line bg-paper disabled:opacity-40"
      >
        <ChevronRight size={15} aria-hidden="true" />
      </button>
      {stage?.byeMemberId ? (
        <span className="rounded bg-jade-soft px-2 py-1 text-[0.7rem] font-bold text-jade">
          本轮有轮空
        </span>
      ) : null}
    </nav>
  );
}

function RelayFinishedBand({
  ranking,
  members,
  viewerMemberId,
  ready,
  readyCount,
  retention,
  onRematch,
  onLeave,
}: {
  ranking: RelayRankingView[];
  members: readonly MemberView[];
  viewerMemberId: string;
  ready: boolean;
  readyCount: number;
  retention: string;
  onRematch: () => void;
  onLeave: () => void;
}) {
  return (
    <section
      className="mb-3 border-y border-jade bg-jade-soft px-3 py-3"
      aria-labelledby="relay-final-ranking"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2
            id="relay-final-ranking"
            className="m-0 text-[0.9rem] font-black text-jade"
          >
            最终排名
          </h2>
          <span className="text-[0.7rem] text-ink-soft">
            房间保留 {retention}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRematch}
            disabled={ready}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-[5px] bg-vermilion px-3 text-[0.72rem] font-bold text-white disabled:opacity-50"
          >
            <RotateCcw size={14} aria-hidden="true" />
            {ready ? `已确认 ${readyCount}` : "再来一局"}
          </button>
          <button
            type="button"
            onClick={onLeave}
            className="min-h-8 rounded-[5px] border border-line-strong bg-paper px-3 text-[0.72rem] font-bold"
          >
            退出房间
          </button>
        </div>
      </div>
      <ol className="mt-3 grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
        {[...ranking]
          .sort(
            (left, right) => left.rank - right.rank || left.seat - right.seat,
          )
          .map((entry) => {
            const name =
              members.find((member) => member.memberId === entry.memberId)
                ?.displayName ?? "玩家";
            const suffix =
              entry.memberId === viewerMemberId ? "我" : `P${entry.seat}`;
            return (
              <li
                key={entry.memberId}
                className={`flex min-w-0 items-center justify-between gap-2 rounded border px-2 py-1 text-[0.72rem] ${entry.memberId === viewerMemberId ? "border-vermilion bg-paper" : "border-line bg-paper-muted"}`}
              >
                <span className="min-w-0 truncate font-bold">
                  第 {entry.rank} 名 · {name}({suffix})
                </span>
                <span className="shrink-0 tabular-nums">
                  {entry.score} 分
                  {entry.survivedStages !== undefined
                    ? ` · 存留 ${entry.survivedStages} 轮`
                    : ""}
                </span>
              </li>
            );
          })}
      </ol>
    </section>
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
