"use client";

// 房间大厅：邀请模块、成员台账、权威就绪投影与分级操作。
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
import { PageHeader } from "../layout/PageHeader";
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
  minPlayers,
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
  minPlayers: number;
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
  const [copyFeedback, setCopyFeedback] = useState<
    "idle" | "success" | "error"
  >("idle");
  const mine =
    viewerRole === "player"
      ? members.find((member) => member.memberId === viewerMemberId)
      : undefined;
  const missingPlayers = Math.max(0, minPlayers - playerCount);
  const disconnectedMembers = members.filter(
    (member) => member.status !== "connected",
  );
  const unreadyConnectedMembers = members.filter(
    (member) => member.status === "connected" && !member.ready,
  );
  const allReady =
    members.length === playerCount &&
    playerCount >= minPlayers &&
    members.every((member) => member.status === "connected" && member.ready);
  const blockerParts = [
    members.length !== playerCount ? "正在同步房间成员。" : "",
    missingPlayers > 0 ? `还需 ${missingPlayers} 名玩家达到开局人数。` : "",
    disconnectedMembers.length > 0
      ? `离线：${disconnectedMembers.map((member) => member.displayName).join("、")}。`
      : "",
    unreadyConnectedMembers.length > 0
      ? `未准备：${unreadyConnectedMembers
          .map((member) => member.displayName)
          .join("、")}。`
      : "",
  ].filter(Boolean);
  const blockerSummary = allReady
    ? "所有玩家均在线且已准备，正在开始对局……"
    : blockerParts.join(" ") || "等待其他玩家准备。";
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

  useEffect(() => {
    if (copyFeedback !== "success") return;
    const timeout = window.setTimeout(() => setCopyFeedback("idle"), 1800);
    return () => window.clearTimeout(timeout);
  }, [copyFeedback]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopyFeedback("success");
    } catch {
      setCopyFeedback("error");
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

  const progressionCopy = allReady
    ? "所有玩家均在线且已准备，正在开始对局……"
    : viewerRole === "spectator"
      ? availableSeats > 0
        ? "当前有可加入席位；认领后可参与准备。"
        : "玩家准备完成后自动开始，你正在观战。"
      : !mine
        ? "正在同步你的房间身份……"
        : mine.status !== "connected"
          ? "连接恢复后才能准备。"
          : mine.ready
            ? "你已准备，仍可在开局前取消。"
            : "你还未准备；确认房间设置与成员后即可准备。";
  const leaveLabel = isHost
    ? "关闭并离开"
    : viewerRole === "spectator"
      ? "离开观战"
      : "离开房间";
  const leaveHint = isHost ? "房主离开会关闭房间。" : "";

  return (
    <section className="room-lobby-page">
      <PageHeader
        description={`${modeLabel}${mode === "relay" ? ` ${turnSeconds}s` : ""} · ${formatLabel}`}
        title="等待开局"
      />

      <div className="room-lobby-content">
        <Paper
          animateOnMount={false}
          as="div"
          className="room-lobby-share"
          elevation="sm"
          folded
          pattern={false}
          sticker={false}
          unfoldOnHover={false}
        >
          <div className="room-lobby-share-heading">
            <strong>邀请好友加入</strong>
            <p>将这个 6 位房间号发给好友；好友可在「多人大厅」加入。</p>
          </div>
          <div className="room-lobby-share-row">
            <div className="room-lobby-share-code-group">
              <span>房间号</span>
              <code className="room-lobby-share-code" tabIndex={0}>
                {roomCode}
              </code>
            </div>
            <PaperButton
              className="room-lobby-copy-action"
              folded={false}
              onClick={copyCode}
              tone="theme"
            >
              {copyFeedback === "success" ? (
                <Check size={17} aria-hidden="true" />
              ) : (
                <Copy size={17} aria-hidden="true" />
              )}
              复制房间号
            </PaperButton>
          </div>
          <p
            aria-atomic="true"
            aria-live={copyFeedback === "error" ? "assertive" : "polite"}
            className={`room-lobby-copy-status${
              copyFeedback === "error" ? " room-lobby-copy-status-error" : ""
            }`}
            role={copyFeedback === "error" ? "alert" : "status"}
          >
            {copyFeedback === "success"
              ? "房间号已复制。"
              : copyFeedback === "error"
                ? "复制失败，请手动选择房间号。"
                : "也可以手动选择房间号复制。"}
          </p>
          <p
            aria-atomic="true"
            aria-live="polite"
            className="room-lobby-blocker-status"
            role="status"
          >
            {blockerSummary}
          </p>
        </Paper>

        <section className="room-lobby-section">
          <SectionHeading
            description={`观战 ${spectatorCount} · ${
              availableSeats > 0
                ? `还有 ${availableSeats} 个可加入席位`
                : "当前没有可加入席位"
            }`}
            title={
              <span className="room-lobby-member-heading">
                房间成员
                <span>
                  玩家 {playerCount}/{playerLimit}
                </span>
              </span>
            }
          />
          <Paper
            animateOnMount={false}
            as="div"
            className="paper-data-table room-lobby-member-ledger"
            elevation="sm"
            folded={false}
            pattern={false}
            sticker={false}
            unfoldOnHover={false}
          >
            <table>
              <caption className="sr-only">
                房间玩家 {playerCount}/{playerLimit}，观战 {spectatorCount}
              </caption>
              <thead className="paper-data-table-header">
                <tr className="paper-data-table-row">
                  <th scope="col">席位</th>
                  <th scope="col">成员</th>
                  <th scope="col">连接</th>
                  <th scope="col">准备</th>
                </tr>
              </thead>
              <tbody className="paper-data-table-body">
                {members.length > 0 ? (
                  sortMembersBySeat(members).map((member) => (
                    <tr className="paper-data-table-row" key={member.memberId}>
                      <td className="room-lobby-member-seat">P{member.seat}</td>
                      <th scope="row" title={member.displayName}>
                        <span className="room-lobby-member-name">
                          {member.displayName}
                        </span>
                        <span className="room-lobby-member-badges">
                          {member.seat === 1 ? <span>房主</span> : null}
                          {member.memberId === viewerMemberId ? (
                            <span>我</span>
                          ) : null}
                        </span>
                      </th>
                      <td>
                        <span
                          className="room-lobby-connection-state"
                          data-status={member.status}
                        >
                          {MEMBER_STATUS_LABEL[member.status] ?? member.status}
                        </span>
                      </td>
                      <td>
                        <span
                          className="room-lobby-ready-state"
                          data-ready={member.ready ? "true" : "false"}
                        >
                          {member.ready ? "已准备" : "未准备"}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr className="paper-data-table-row">
                    <td colSpan={4}>正在同步房间成员……</td>
                  </tr>
                )}
              </tbody>
              <tfoot className="paper-data-table-header">
                <tr className="paper-data-table-row">
                  <td colSpan={4}>
                    {availableSeats > 0
                      ? `还有 ${availableSeats} 个可加入席位`
                      : "房间当前没有可加入席位"}
                  </td>
                </tr>
              </tfoot>
            </table>
          </Paper>
        </section>

        {isHost && mode === "race" ? (
          <section className="room-lobby-section">
            <SectionHeading
              description="有人准备后将锁定设置；开局仍由服务器状态决定。"
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
                    onClick={applyLimit}
                  >
                    应用
                  </PaperButton>
                </PaperSegmentGroup>
              </div>
            ) : null}
          </section>
        ) : null}

        <div className="room-lobby-ready-flow">
          <Paper
            animateOnMount={false}
            as="div"
            className="room-lobby-progression"
            elevation="sm"
            folded={false}
            pattern={false}
            sticker={false}
            unfoldOnHover={false}
          >
            <div className="room-lobby-progression-copy">
              <strong>准备开局</strong>
              <p>至少 {minPlayers} 名玩家在线且全员准备后自动开始。</p>
              <p aria-atomic="true" aria-live="polite" role="status">
                {progressionCopy}
              </p>
            </div>
            <div className="room-lobby-progression-action">
              {viewerRole === "player" ? (
                <PaperButton
                  ariaPressed={Boolean(mine?.ready)}
                  className="room-lobby-ready-action"
                  disabled={!mine || mine.status !== "connected"}
                  filled={!mine?.ready}
                  onClick={() => onReady(!mine?.ready)}
                  tone="theme"
                >
                  <Play size={16} aria-hidden="true" />
                  {mine?.ready ? "取消准备" : "我准备好了"}
                </PaperButton>
              ) : availableSeats > 0 ? (
                <PaperButton
                  className="room-lobby-claim-action"
                  disabled={claimBusy}
                  filled
                  onClick={claimSeat}
                  tone="theme"
                >
                  认领席位
                </PaperButton>
              ) : null}
            </div>
          </Paper>

          {actionError ? (
            <p role="alert" className="room-lobby-error">
              {actionError}
            </p>
          ) : null}

          <div className="room-lobby-exit">
            {leaveHint ? <p>{leaveHint}</p> : null}
            <PaperButton
              className="room-lobby-leave-action"
              folded={false}
              onClick={onLeave}
              tone="danger"
            >
              <LogOut size={16} aria-hidden="true" />
              {leaveLabel}
            </PaperButton>
          </div>
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
