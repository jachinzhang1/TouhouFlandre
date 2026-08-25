"use client";

// 房间大厅（08 §10.2）：房间号大字 + 复制、成员列表与就绪态、准备/离开按钮。
import { Check, Copy, LogOut, Play } from "lucide-react";
import { useEffect, useState } from "react";
import type { MultiRoomFormat } from "@touhouflandre/shared";
import type { components } from "../generated/api";
import {
  isNPlayerRaceUiEnabled,
  isNPlayerRelayUiEnabled,
  isRelayEliminationUiEnabled,
} from "../config/multiplayerRollout";
import { ApiRequestError } from "../lib/api";
import { sortMembersBySeat } from "../domain/memberCollections";
import { RaceEliminationSwitch } from "./RaceEliminationSwitch";
import { PlayerLimitControl } from "./PlayerLimitControl";
import { RelayEliminationSwitch } from "./RelayEliminationSwitch";

type MemberView = components["schemas"]["MemberView"];
type StartBlockedReason = components["schemas"]["StartBlockedReason"];
import {
  minimumPlayerLimitFor,
  MULTIPLAYER_MODE_LABELS,
  PLAYER_LIMIT_ADAPTERS,
  relaySettingsSummary,
  ROOM_FORMAT_LABELS,
  raceSettingsSummary,
} from "../domain/multiRoom";

const MEMBER_STATUS_LABEL: Record<string, string> = {
  connected: "在线",
  disconnected: "离线",
  left: "已离开",
};

export function RoomLobby({
  roomCode,
  format,
  mode,
  turnSeconds,
  members,
  mySlot,
  onReady,
  onLeave,
  playerLimit,
  playerCount,
  availableSeats,
  spectatorCount,
  isHost,
  raceEliminationEnabled,
  relayEliminationEnabled = false,
  startBlockedReason,
  onApplySettings,
  onClaimSeat,
  viewerRole,
  viewerMemberId,
}: {
  roomCode: string;
  format: string;
  mode: string;
  turnSeconds: number;
  members: MemberView[];
  mySlot: number;
  playerLimit: number;
  playerCount: number;
  availableSeats: number;
  spectatorCount: number;
  isHost: boolean;
  onReady: (ready?: boolean) => void;
  raceEliminationEnabled: boolean;
  relayEliminationEnabled?: boolean;
  startBlockedReason?: StartBlockedReason;
  onApplySettings?: (settings: {
    playerLimit?: number;
    raceEliminationEnabled?: boolean;
    relayEliminationEnabled?: boolean;
  }) => Promise<void>;
  onClaimSeat?: () => Promise<void>;
  viewerRole?: "player" | "spectator";
  viewerMemberId?: string | null;
  onLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const mine =
    viewerRole === "player"
      ? members.find((member) => member.memberId === viewerMemberId)
      : undefined;
  const allReady = members.length >= 2 && members.every((m) => m.ready);
  const [limitDraft, setLimitDraft] = useState(playerLimit);
  const [eliminationDraft, setEliminationDraft] = useState(
    mode === "relay" ? relayEliminationEnabled : raceEliminationEnabled,
  );
  const [limitBusy, setLimitBusy] = useState(false);
  const [claimBusy, setClaimBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const normalizedMode = mode === "relay" ? "relay" : "race";
  const playerLimitAdapter = PLAYER_LIMIT_ADAPTERS[normalizedMode];
  const minimumLimit = minimumPlayerLimitFor(normalizedMode, playerCount);
  const settingsLocked = members.some((member) => member.ready);
  const nPlayerRaceEnabled = isNPlayerRaceUiEnabled();
  const nPlayerRelayEnabled = isNPlayerRelayUiEnabled();
  const relayEliminationUiEnabled = isRelayEliminationUiEnabled();
  const eliminationThreshold = mode === "relay" ? 4 : 3;
  const effectiveEliminationDraft =
    mode === "relay" && !relayEliminationUiEnabled
      ? relayEliminationEnabled
      : limitDraft >= eliminationThreshold
        ? eliminationDraft
        : false;
  const eliminationSettingChanged =
    effectiveEliminationDraft !==
    (mode === "relay" ? relayEliminationEnabled : raceEliminationEnabled);
  const settingsChanged =
    limitDraft !== playerLimit ||
    (mode === "relay" && !relayEliminationUiEnabled
      ? false
      : eliminationSettingChanged);

  useEffect(() => setLimitDraft(playerLimit), [playerLimit]);
  useEffect(
    () =>
      setEliminationDraft(
        mode === "relay" ? relayEliminationEnabled : raceEliminationEnabled,
      ),
    [mode, raceEliminationEnabled, relayEliminationEnabled],
  );

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用（非 https）：提示手动复制
    }
  };

  return (
    <section className="px-[18px] pt-12 pb-8">
      <div
        className="mx-auto max-w-[560px] rounded-[10px] border border-line bg-paper p-8 text-center shadow-sm"
        data-room-lobby-card
      >
        <p className="mt-0 mb-2 text-[0.72rem] font-black tracking-[0.14em] text-vermilion">
          ROOM LOBBY
        </p>
        <h1
          className="mt-0 mb-1 font-brand text-[3.2rem] leading-none tracking-[0.1em]"
          data-room-code
        >
          {roomCode}
        </h1>
        <p className="mb-5 text-[0.8rem] text-ink-soft">
          {MULTIPLAYER_MODE_LABELS[
            mode as keyof typeof MULTIPLAYER_MODE_LABELS
          ] ?? mode}
          {mode === "relay" ? ` ${turnSeconds}s` : ""} ·{" "}
          {ROOM_FORMAT_LABELS[format as keyof typeof ROOM_FORMAT_LABELS] ??
            format}{" "}
          · 把房间号发给好友加入
        </p>

        <button
          type="button"
          onClick={copyCode}
          className="mb-6 inline-flex items-center gap-1.5 rounded-[6px] border border-line-strong bg-paper-muted px-3 py-1.5 text-[0.8rem] font-semibold hover:bg-paper"
        >
          {copied ? (
            <Check size={14} className="text-jade" />
          ) : (
            <Copy size={14} />
          )}
          {copied ? "已复制" : "复制房间号"}
        </button>

        <ul className="mb-6 grid gap-2 text-left">
          {sortMembersBySeat(members).map((member) => (
            <li
              key={member.memberId}
              data-room-member
              className="flex min-w-0 items-center justify-between gap-3 rounded-[6px] border border-line bg-paper-muted px-3.5 py-2.5"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={`inline-flex size-5 items-center justify-center rounded text-[0.62rem] font-black ${
                    member.seat === 1
                      ? "bg-vermilion text-white"
                      : "bg-jade text-white"
                  }`}
                >
                  {member.seat}
                </span>
                <span className="min-w-0 break-words text-[0.85rem] font-semibold">
                  {member.displayName}
                  {member.memberId === viewerMemberId ? "（我）" : ""}
                </span>
              </span>
              <span className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-[0.72rem] text-ink-soft">
                {member.ready ? (
                  <span className="rounded bg-jade-soft px-1.5 py-0.5 font-bold text-jade">
                    已准备
                  </span>
                ) : (
                  <span className="rounded bg-paper px-1.5 py-0.5">未准备</span>
                )}
                {MEMBER_STATUS_LABEL[member.status] ?? member.status}
              </span>
            </li>
          ))}
          {availableSeats > 0 && (
            <li className="rounded-[6px] border border-dashed border-line-strong px-3.5 py-2.5 text-[0.78rem] text-ink-soft">
              等待好友加入……（房间号{" "}
              <span className="inline-block w-[6ch] font-mono" data-room-code>
                {roomCode}
              </span>
              ），剩余席位 {availableSeats}
            </li>
          )}
        </ul>

        <p className="mb-4 text-left text-[0.78rem] text-ink-soft">
          当前玩家 {playerCount}/{playerLimit} · 观战 {spectatorCount} ·{" "}
          {mode === "relay"
            ? `${playerLimit} 人上限 · 偶数且全员准备后开始`
            : "至少 2 人且全员准备后开始"}
        </p>
        {isHost && (mode === "race" || mode === "relay") ? (
          <p className="mb-3 text-left text-[0.75rem] text-ink-soft">
            保持未准备可继续等人；准备后若当前全员已准备将立即开局。
          </p>
        ) : null}
        {isHost &&
        ((mode === "race" && nPlayerRaceEnabled) ||
          (mode === "relay" && nPlayerRelayEnabled)) ? (
          <div className="mb-4 grid gap-3 text-left">
            <div className="flex items-end gap-4">
              <PlayerLimitControl
                id="player-limit"
                ariaLabel="玩家上限"
                value={limitDraft}
                allowedValues={playerLimitAdapter.allowedValues}
                min={minimumLimit}
                max={8}
                step={playerLimitAdapter.step}
                disabled={settingsLocked || limitBusy}
                onChange={setLimitDraft}
              />
              {mode === "race" ? (
                <RaceEliminationSwitch
                  checked={effectiveEliminationDraft}
                  disabled={
                    limitDraft < eliminationThreshold ||
                    settingsLocked ||
                    limitBusy
                  }
                  onChange={(checked) => setEliminationDraft(checked)}
                  className="shrink-0 pb-1"
                />
              ) : relayEliminationUiEnabled ? (
                <RelayEliminationSwitch
                  checked={effectiveEliminationDraft}
                  disabled={
                    limitDraft < eliminationThreshold ||
                    settingsLocked ||
                    limitBusy
                  }
                  onChange={(checked) => setEliminationDraft(checked)}
                  className="shrink-0 pb-1"
                />
              ) : null}
            </div>
            <p className="m-0 text-[0.78rem] leading-6 text-ink-soft">
              {mode === "race"
                ? raceSettingsSummary(
                    format as MultiRoomFormat,
                    limitDraft,
                    effectiveEliminationDraft,
                  )
                : relaySettingsSummary(
                    format as MultiRoomFormat,
                    limitDraft,
                    effectiveEliminationDraft,
                  )}
            </p>
            <button
              type="button"
              disabled={
                limitBusy ||
                !settingsChanged ||
                limitDraft < minimumLimit ||
                settingsLocked ||
                !onApplySettings
              }
              onClick={async () => {
                if (!onApplySettings) return;
                setActionError("");
                setLimitBusy(true);
                try {
                  const body: {
                    playerLimit?: number;
                    raceEliminationEnabled?: boolean;
                    relayEliminationEnabled?: boolean;
                  } = {};
                  if (limitDraft !== playerLimit) body.playerLimit = limitDraft;
                  const authoritativeElimination =
                    mode === "relay"
                      ? relayEliminationEnabled
                      : raceEliminationEnabled;
                  if (effectiveEliminationDraft !== authoritativeElimination) {
                    if (mode === "relay" && relayEliminationUiEnabled)
                      body.relayEliminationEnabled = effectiveEliminationDraft;
                    else if (mode === "race")
                      body.raceEliminationEnabled = effectiveEliminationDraft;
                  }
                  await onApplySettings(body);
                } catch (error) {
                  setLimitDraft(playerLimit);
                  setEliminationDraft(
                    mode === "relay"
                      ? relayEliminationEnabled
                      : raceEliminationEnabled,
                  );
                  setActionError(lobbyActionError(error));
                } finally {
                  setLimitBusy(false);
                }
              }}
              className="w-fit rounded border border-line px-2 py-1 text-xs font-bold disabled:opacity-50"
            >
              {limitBusy ? "应用中…" : "应用"}
            </button>
          </div>
        ) : null}
        {viewerRole === "spectator" && availableSeats > 0 && (
          <button
            type="button"
            disabled={claimBusy}
            onClick={async () => {
              if (!onClaimSeat) return;
              setActionError("");
              setClaimBusy(true);
              try {
                await onClaimSeat();
              } catch (error) {
                setActionError(lobbyActionError(error));
              } finally {
                setClaimBusy(false);
              }
            }}
            className="mb-3 flex w-full items-center justify-center rounded border border-jade bg-jade-soft px-3 py-2 font-bold text-jade disabled:opacity-50"
          >
            认领席位
          </button>
        )}
        {actionError ? (
          <p role="alert" className="mb-3 text-[0.75rem] text-vermilion">
            {actionError}
          </p>
        ) : null}

        <div className="grid gap-2">
          {viewerRole === "player" ? (
            <button
              type="button"
              disabled={!mine}
              onClick={() => onReady(!mine?.ready)}
              className="flex w-full items-center justify-center gap-2 rounded-[6px] bg-vermilion px-4 py-2.5 font-bold text-white hover:bg-vermilion-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play size={16} aria-hidden="true" />
              {mine?.ready ? "取消准备" : "准备"}
            </button>
          ) : null}
          {allReady && !startBlockedReason && (
            <p className="m-0 text-[0.75rem] text-jade" aria-live="polite">
              当前全员已就绪，对局即将开始……
            </p>
          )}
          {startBlockedReason ? (
            <p
              className="m-0 text-left text-[0.75rem] text-vermilion"
              role="status"
              aria-live="polite"
            >
              {startBlockedReasonLabel(startBlockedReason)}
            </p>
          ) : null}
          <button
            type="button"
            onClick={onLeave}
            className="flex w-full items-center justify-center gap-2 rounded-[6px] border border-line-strong bg-paper px-4 py-2 font-semibold text-ink-soft hover:bg-paper-muted"
          >
            <LogOut size={15} aria-hidden="true" />
            离开房间
          </button>
        </div>
      </div>
    </section>
  );
}

function startBlockedReasonLabel(reason: StartBlockedReason): string {
  switch (reason) {
    case "odd_player_count":
      return "当前玩家数为奇数，接力需要偶数玩家才能开始。";
    case "player_not_ready":
      return "还有玩家未准备，暂时无法开始。";
    case "player_disconnected":
      return "有玩家已离线，等待其恢复连接。";
    case "not_enough_players":
      return "至少需要 2 名玩家才能开始。";
    case "host_missing":
      return "房主当前不在房间，暂时无法开始。";
    case "invalid_player_count":
      return "当前玩家阵容不符合接力开局要求。";
  }
}

function lobbyActionError(error: unknown): string {
  if (!(error instanceof ApiRequestError))
    return error instanceof Error ? error.message : "操作失败，请重试。";
  if (error.code === "ROOM_FULL")
    return "席位刚被其他观战者认领，请刷新后重试。";
  if (error.code === "MATCH_ALREADY_STARTED")
    return "对局刚刚开始，已无法认领席位。";
  if (error.code === "ROOM_SETTINGS_LOCKED")
    return "当前有人已准备，请先取消准备后再修改。";
  if (error.code === "INVALID_PLAYER_LIMIT")
    return "玩家上限不符合当前模式要求，且不能低于当前玩家数。";
  return error.message;
}
