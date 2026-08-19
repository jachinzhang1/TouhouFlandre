"use client";

// 房间大厅（08 §10.2）：房间号大字 + 复制、成员列表与就绪态、准备/离开按钮。
import { Check, Copy, LogOut, Play } from "lucide-react";
import { useEffect, useState } from "react";
import type { components } from "../../generated/api";
import { isNPlayerRaceUiEnabled } from "../../config/multiplayerRollout";
import { ApiRequestError } from "../../lib/api";
import { sortMembersBySeat } from "../../domain/memberCollections";

type MemberView = components["schemas"]["MemberView"];
import {
  MULTIPLAYER_MODE_LABELS,
  ROOM_FORMAT_LABELS,
} from "../../domain/multiRoom";
import {
  Paper,
  PaperButton,
  PaperNumberInput,
  PaperRange,
  PaperSegmentGroup,
  PaperSegmentSeparator,
} from "@/components/paper";
import { PageHeader, PageHeaderAction } from "../layout/PageHeader";
import { SectionHeading } from "../layout/SectionHeading";

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
  onApplyLimit,
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
  onApplyLimit?: (limit: number) => Promise<void>;
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
  const [limitBusy, setLimitBusy] = useState(false);
  const [claimBusy, setClaimBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const minimumLimit = Math.max(2, playerCount);
  const settingsLocked = members.some((member) => member.ready);
  const nPlayerRaceEnabled = isNPlayerRaceUiEnabled();
  const modeLabel =
    MULTIPLAYER_MODE_LABELS[mode as keyof typeof MULTIPLAYER_MODE_LABELS] ??
    mode;
  const formatLabel =
    ROOM_FORMAT_LABELS[format as keyof typeof ROOM_FORMAT_LABELS] ?? format;

  useEffect(() => setLimitDraft(playerLimit), [playerLimit]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用（非 https）：提示手动复制
    }
  };

  const applyLimit = async () => {
    if (!onApplyLimit) return;
    setActionError("");
    setLimitBusy(true);
    try {
      await onApplyLimit(limitDraft);
    } catch (error) {
      setActionError(lobbyActionError(error));
    } finally {
      setLimitBusy(false);
    }
  };

  const claimSeat = async () => {
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
  };

  return (
    <section className="room-lobby-page">
      <PageHeader
        description={`${modeLabel}${mode === "relay" ? ` ${turnSeconds}s` : ""} · ${formatLabel} · 把房间号发给好友加入。`}
        rightSlot={
          <PageHeaderAction ariaLabel="复制房间号" onClick={copyCode}>
            {copied ? (
              <Check size={18} className="text-jade" aria-hidden="true" />
            ) : (
              <Copy size={18} aria-hidden="true" />
            )}
            {copied ? "已复制" : "复制房间号"}
          </PageHeaderAction>
        }
        rightSlotInset="leading-icon-action"
        title={<span className="room-lobby-code">{roomCode}</span>}
      />

      <div className="room-lobby-content">
        <section className="room-lobby-section">
          <SectionHeading
            description={`当前玩家 ${playerCount}/${playerLimit} · 观战 ${spectatorCount} · ${
              mode === "relay" ? "固定 2 人" : "至少 2 人且全员准备后开始。"
            }`}
            title="房间成员"
          />
          <ul className="room-lobby-member-list">
            {sortMembersBySeat(members).map((member) => (
              <li key={member.memberId}>
                <div className="room-lobby-member-row">
                  <span className="room-lobby-member-identity">
                    <span
                      className="room-lobby-seat"
                      data-host={member.seat === 1 ? "true" : "false"}
                    >
                      {member.seat}
                    </span>
                    <span className="room-lobby-member-name">
                      {member.displayName}
                      {member.memberId === viewerMemberId ? "（我）" : ""}
                    </span>
                  </span>
                  <span className="room-lobby-member-state">
                    <span
                      className="room-lobby-ready-state"
                      data-ready={member.ready ? "true" : "false"}
                    >
                      {member.ready ? "已准备" : "未准备"}
                    </span>
                    <span>
                      {MEMBER_STATUS_LABEL[member.status] ?? member.status}
                    </span>
                  </span>
                </div>
              </li>
            ))}
            {availableSeats > 0 ? (
              <li>
                <Paper
                  animateOnMount={false}
                  as="div"
                  className="room-lobby-empty-seat"
                  folded={false}
                  sticker={false}
                  unfoldOnHover={false}
                >
                  等待好友加入，剩余席位 {availableSeats}
                </Paper>
              </li>
            ) : null}
          </ul>
        </section>

        {isHost && mode === "race" ? (
          <section className="room-lobby-section">
            <SectionHeading
              description="保持未准备可继续等人；全员准备后将立即开局。"
              title="房间设置"
            />
            {nPlayerRaceEnabled ? (
              <div className="room-lobby-limit-field">
                <span className="room-lobby-limit-label">玩家上限</span>
                <PaperSegmentGroup
                  className="room-lobby-limit-control"
                  label="玩家上限"
                >
                  <PaperRange
                    ariaLabel="玩家上限"
                    disabled={limitBusy || settingsLocked}
                    max={8}
                    min={minimumLimit}
                    onChange={(value) =>
                      setLimitDraft(Math.min(8, Math.max(minimumLimit, value)))
                    }
                    value={limitDraft}
                  />
                  <PaperSegmentSeparator />
                  <PaperNumberInput
                    ariaLabel="玩家上限数值"
                    disabled={limitBusy || settingsLocked}
                    max={8}
                    min={minimumLimit}
                    onChange={(value) =>
                      setLimitDraft(Math.min(8, Math.max(minimumLimit, value)))
                    }
                    suffix="人"
                    value={limitDraft}
                  />
                  <PaperSegmentSeparator />
                  <PaperButton
                    disabled={
                      limitBusy ||
                      limitDraft < minimumLimit ||
                      limitDraft === playerLimit ||
                      settingsLocked
                    }
                    filled
                    folded
                    onClick={applyLimit}
                  >
                    应用
                  </PaperButton>
                </PaperSegmentGroup>
              </div>
            ) : null}
          </section>
        ) : null}

        {viewerRole === "spectator" && availableSeats > 0 ? (
          <PaperButton
            className="room-lobby-claim-action"
            disabled={claimBusy}
            filled
            onClick={claimSeat}
            tone="success"
          >
            认领席位
          </PaperButton>
        ) : null}

        {actionError ? (
          <p role="alert" className="room-lobby-error">
            {actionError}
          </p>
        ) : null}

        <div className="room-lobby-actions">
          {viewerRole === "player" ? (
            <PaperButton
              className="room-lobby-ready-action"
              disabled={!mine}
              filled
              onClick={() => onReady(!mine?.ready)}
              tone="theme"
            >
              <Play size={16} aria-hidden="true" />
              {mine?.ready ? "取消准备" : "准备"}
            </PaperButton>
          ) : null}
          {allReady ? (
            <p className="room-lobby-ready-notice" aria-live="polite">
              当前全员已就绪，对局即将开始……
            </p>
          ) : null}
          <PaperButton
            className="room-lobby-leave-action"
            folded={false}
            onClick={onLeave}
          >
            <LogOut size={16} aria-hidden="true" />
            离开房间
          </PaperButton>
        </div>
      </div>
    </section>
  );
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
    return "玩家上限必须为 2 至 8，且不能低于当前玩家数。";
  return error.message;
}
