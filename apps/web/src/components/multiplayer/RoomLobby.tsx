"use client";

import { Check, Copy, Eye, LogOut, Play, Users } from "lucide-react";
import { useEffect, useState } from "react";
import type { MultiRoomFormat } from "@touhouflandre/shared";
import type { components } from "../../generated/api";
import {
  isNPlayerRaceUiEnabled,
  isNPlayerRelayUiEnabled,
  isRelayEliminationUiEnabled,
} from "../../config/multiplayerRollout";
import { ApiRequestError } from "../../lib/api";
import { sortMembersBySeat } from "../../domain/memberCollections";
import {
  Paper,
  PaperButton,
  PaperRange,
  PaperSwitch,
} from "@/components/paper";
import { PageHeader } from "../layout/PageHeader";
import { SectionHeading } from "../layout/SectionHeading";

type MemberView = components["schemas"]["MemberView"];
type StartBlockedReason = components["schemas"]["StartBlockedReason"];
import {
  minimumPlayerLimitFor,
  MULTIPLAYER_MODE_LABELS,
  PLAYER_LIMIT_ADAPTERS,
  relaySettingsSummary,
  ROOM_FORMAT_LABELS,
  raceSettingsSummary,
} from "../../domain/multiRoom";

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
  const [copyError, setCopyError] = useState(false);
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

  const readyCount = members.filter((member) => member.ready).length;
  const canEditSettings =
    isHost &&
    ((mode === "race" && nPlayerRaceEnabled) ||
      (mode === "relay" && nPlayerRelayEnabled));
  const modeLabel =
    MULTIPLAYER_MODE_LABELS[mode as keyof typeof MULTIPLAYER_MODE_LABELS] ??
    mode;
  const formatLabel =
    ROOM_FORMAT_LABELS[format as keyof typeof ROOM_FORMAT_LABELS] ?? format;

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopyError(false);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  };

  return (
    <section className="room-lobby-page" data-room-lobby-card>
      <PageHeader
        title="房间大厅"
        description="好友在此相聚，准备好就一起开启竞猜。"
        rightSlot={
          <PaperButton
            ariaLabel="离开房间"
            className="room-lobby-leave-action"
            tone="danger"
            onClick={onLeave}
          >
            <LogOut size={18} aria-hidden="true" />
            离开房间
          </PaperButton>
        }
        rightSlotInset="padded-label"
      />

      <div className="room-lobby-content">
        <Paper
          as="article"
          className="room-lobby-players"
          animateOnMount={false}
          elevation="sm"
          folded={false}
          sticker={false}
          unfoldOnHover={false}
        >
          <SectionHeading
            title="玩家席位"
            description={`当前玩家 ${playerCount}/${playerLimit} · 观战 ${spectatorCount}`}
          />
          <ul className="room-lobby-member-list" aria-label="房间玩家">
            {sortMembersBySeat(members).map((member) => (
              <li
                key={member.memberId}
                data-room-member
                data-self={member.memberId === viewerMemberId}
                className="room-lobby-member"
              >
                <span
                  className="room-lobby-seat"
                  aria-label={`席位 ${member.seat}`}
                >
                  {String(member.seat).padStart(2, "0")}
                </span>
                <span className="room-lobby-member-copy">
                  <span className="room-lobby-member-name">
                    {member.displayName}
                    {member.memberId === viewerMemberId ? "（我）" : ""}
                  </span>
                  <span
                    className="room-lobby-connection-state"
                    data-status={member.status}
                  >
                    <span aria-hidden="true" />
                    {MEMBER_STATUS_LABEL[member.status] ?? member.status}
                  </span>
                </span>
                <span
                  className="room-lobby-ready-state"
                  data-ready={member.ready}
                >
                  {member.ready ? <Check size={13} aria-hidden="true" /> : null}
                  {member.ready ? "已准备" : "未准备"}
                </span>
              </li>
            ))}
            {availableSeats > 0 ? (
              <li className="room-lobby-empty-seat">
                <Users size={22} strokeWidth={1.5} aria-hidden="true" />
                <span>
                  <strong>等待好友加入</strong>
                  <span>
                    分享房间号，邀请好友入席 · 剩余 {availableSeats} 席
                  </span>
                </span>
              </li>
            ) : null}
          </ul>

          <div className="room-lobby-ready-flow">
            <div className="room-lobby-progression-copy">
              <strong>
                {viewerRole === "spectator"
                  ? "你正在观战席"
                  : mine?.ready
                    ? "已准备，等待其他玩家"
                    : "入席完毕，准备出发"}
              </strong>
              <p>
                {mode === "relay"
                  ? `${playerLimit} 人上限 · 偶数且全员准备后开始`
                  : "至少 2 人且全员准备后开始"}
              </p>
              {isHost && (mode === "race" || mode === "relay") ? (
                <p>保持未准备可继续等人；准备后若当前全员已准备将立即开局。</p>
              ) : null}
            </div>
            <div className="room-lobby-ready-summary">
              <span>
                {readyCount} / {playerCount} 人已准备
              </span>
              <span>
                <Eye size={14} aria-hidden="true" />
                观战 {spectatorCount}
              </span>
            </div>
            {viewerRole === "player" ? (
              <PaperButton
                className="room-lobby-ready-action"
                tone={mine?.ready ? "plain" : "theme"}
                filled={!mine?.ready}
                ariaPressed={Boolean(mine?.ready)}
                disabled={!mine}
                onClick={() => onReady(!mine?.ready)}
              >
                {mine?.ready ? (
                  <Check size={17} aria-hidden="true" />
                ) : (
                  <Play size={17} aria-hidden="true" />
                )}
                {mine?.ready ? "取消准备" : "准备"}
              </PaperButton>
            ) : viewerRole === "spectator" && availableSeats > 0 ? (
              <PaperButton
                className="room-lobby-ready-action"
                tone="theme"
                filled
                disabled={claimBusy || !onClaimSeat}
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
              >
                <Users size={17} aria-hidden="true" />
                {claimBusy ? "认领中…" : "认领席位"}
              </PaperButton>
            ) : null}
            {allReady && !startBlockedReason ? (
              <p className="room-lobby-start-status" role="status">
                当前全员已就绪，对局即将开始……
              </p>
            ) : null}
            {startBlockedReason ? (
              <p
                className="room-lobby-blocker-status"
                role="status"
                aria-live="polite"
              >
                {startBlockedReasonLabel(startBlockedReason)}
              </p>
            ) : null}
          </div>
        </Paper>

        <Paper
          as="article"
          className="room-lobby-details"
          animateOnMount={false}
          elevation="sm"
          folded={false}
          sticker={false}
          unfoldOnHover={false}
        >
          <SectionHeading
            title="邀请好友"
            description="把房间号发给好友，在多人大厅加入。"
          />
          <div className="room-lobby-share-row">
            <span
              className="room-lobby-share-code"
              data-room-code
              aria-label={`房间号 ${roomCode}`}
            >
              {roomCode}
            </span>
            <PaperButton
              compact
              onClick={copyCode}
              ariaLabel={copied ? "已复制" : "复制房间号"}
            >
              {copied ? (
                <Check size={15} aria-hidden="true" />
              ) : (
                <Copy size={15} aria-hidden="true" />
              )}
              {copied ? "已复制" : "复制房间号"}
            </PaperButton>
          </div>
          <p
            className={`room-lobby-copy-status${copyError ? " room-lobby-copy-status-error" : ""}`}
            aria-live="polite"
          >
            {copyError
              ? "复制失败，请选中上方房间号手动复制。"
              : copied
                ? "房间号已复制，快去邀请好友吧。"
                : ""}
          </p>
          <dl className="room-lobby-rules">
            <div>
              <dt>玩法</dt>
              <dd>{modeLabel}</dd>
            </div>
            <div>
              <dt>赛制</dt>
              <dd>{formatLabel}</dd>
            </div>
            {mode === "relay" ? (
              <div>
                <dt>每手限时</dt>
                <dd>{turnSeconds} 秒</dd>
              </div>
            ) : null}
          </dl>
        </Paper>
        {canEditSettings ? (
          <Paper
            as="article"
            className="room-lobby-settings"
            animateOnMount={false}
            elevation="sm"
            folded={false}
            sticker={false}
            unfoldOnHover={false}
          >
            <SectionHeading
              title="房间设置"
              description={
                settingsLocked
                  ? "已有玩家准备，取消准备后可修改。"
                  : "由房主调整，应用后对房间内所有玩家生效。"
              }
            />
            <div className="room-lobby-limit-field">
              <span className="room-lobby-limit-label">玩家上限</span>
              <PaperRange
                ariaLabel="玩家上限"
                value={limitDraft}
                valueLabel={`${limitDraft} 人`}
                valueText={`${limitDraft} 人`}
                min={minimumLimit}
                max={8}
                step={playerLimitAdapter.step}
                disabled={settingsLocked || limitBusy}
                onChange={(value) => {
                  const bounded = Math.max(minimumLimit, Math.min(8, value));
                  setLimitDraft(
                    playerLimitAdapter.allowedValues.reduce(
                      (closest, option) =>
                        Math.abs(option - bounded) < Math.abs(closest - bounded)
                          ? option
                          : closest,
                    ),
                  );
                }}
              />
            </div>
            {mode === "race" || relayEliminationUiEnabled ? (
              <div className="room-lobby-elimination">
                <span>
                  <strong>淘汰</strong>
                  <span>
                    {mode === "relay"
                      ? "4 人及以上可开启接力淘汰赛"
                      : "3 人及以上可开启竞速淘汰赛"}
                  </span>
                </span>
                <PaperSwitch
                  ariaLabel="淘汰"
                  checked={effectiveEliminationDraft}
                  disabled={
                    limitDraft < eliminationThreshold ||
                    settingsLocked ||
                    limitBusy
                  }
                  onChange={setEliminationDraft}
                />
              </div>
            ) : null}
            <div className="room-lobby-settings-footer">
              <p>
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
              <PaperButton
                compact
                tone="theme"
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
                    if (limitDraft !== playerLimit)
                      body.playerLimit = limitDraft;
                    const authoritativeElimination =
                      mode === "relay"
                        ? relayEliminationEnabled
                        : raceEliminationEnabled;
                    if (
                      effectiveEliminationDraft !== authoritativeElimination
                    ) {
                      if (mode === "relay" && relayEliminationUiEnabled)
                        body.relayEliminationEnabled =
                          effectiveEliminationDraft;
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
              >
                {limitBusy ? "应用中…" : "应用"}
              </PaperButton>
            </div>
          </Paper>
        ) : null}
      </div>
      {actionError ? (
        <p role="alert" className="room-lobby-error">
          {actionError}
        </p>
      ) : null}
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
