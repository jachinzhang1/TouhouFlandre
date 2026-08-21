"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import type { RoundEndedPayload } from "@touhouflandre/shared";
import {
  CHARACTER_GUESS_FIELDS,
  isUnlimitedGuessLimit,
  type GuessField,
} from "@touhouflandre/shared";
import type { components } from "../../generated/api";
import type { RoomUiState } from "../../hooks/useRoom";
import {
  countRelaySkips,
  MULTIPLAYER_MODE_LABELS,
  relaySkipRemaining,
  ROOM_FORMAT_SHORT,
} from "../../domain/multiRoom";
import { useRoomClock, formatRemaining } from "../../hooks/useRoomClock";
import { seatForMemberId } from "../../domain/memberCollections";
import { CharacterAvatar } from "../game/CharacterAvatar";
import { FeedbackStatusIcon } from "../game/FeedbackStatusIcon";
import { STATUS_LABEL } from "../game/GuessTable";
import { Paper, PaperButton } from "@/components/paper";
import { SectionHeading } from "../layout/SectionHeading";
import { MemberScoreStrip } from "./MemberScoreStrip";

type MatchView = NonNullable<RoomUiState["match"]>;
type MemberView = components["schemas"]["MemberView"];
type RoundView = components["schemas"]["RoundView"];
type RelayTurnRow = components["schemas"]["RelayTurnRow"];

export function RelayMatchBoard({
  format,
  match,
  round,
  members,
  mySlot,
  roundResult,
  turnAction,
  riskAction,
  fields = CHARACTER_GUESS_FIELDS,
  viewerRole = "player",
}: {
  format: string;
  match: MatchView | null;
  round: RoundView | null;
  members: MemberView[];
  mySlot: 1 | 2;
  roundResult: RoundEndedPayload | null;
  turnAction?: ReactNode;
  riskAction?: ReactNode;
  fields?: readonly GuessField[];
  viewerRole?: "player" | "spectator";
}) {
  const detailsId = useId();
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const roundRemaining = useRoomClock(round?.deadline ?? null);
  const turnRemaining = useRoomClock(round?.turnDeadline ?? null);
  const ended = Boolean(roundResult);
  const rows = (roundResult?.turns ??
    round?.shared?.rows ??
    []) as RelayTurnRow[];
  const maxSkips = round?.maxSkipsPerPlayer ?? 2;
  const maxTurnsPerPlayer = round?.maxTurnsPerPlayer ?? 8;
  const hasUnlimitedTurns = isUnlimitedGuessLimit(maxTurnsPerPlayer);
  const mySkipCount = countRelaySkips(rows, mySlot);
  const mySkipRemaining = relaySkipRemaining(rows, mySlot, maxSkips);
  const currentSlot =
    round?.turnSeat === 2 ? 2 : round?.turnSeat === 1 ? 1 : null;
  const currentSkipRemaining = currentSlot
    ? relaySkipRemaining(rows, currentSlot, maxSkips)
    : maxSkips;
  const isPlaying = round?.status === "playing" && !ended;
  const isMyActiveTurn =
    viewerRole === "player" && isPlaying && currentSlot === mySlot;
  const currentActor = currentSlot
    ? memberLabel(currentSlot, members, viewerRole, mySlot)
    : null;
  const handClock =
    isPlaying && round?.turnDeadline && turnRemaining > 0
      ? formatRemaining(turnRemaining)
      : null;
  const roundClock =
    round && !ended && roundRemaining > 0
      ? formatRemaining(roundRemaining)
      : null;
  const forfeitedSlot =
    seatForMemberId(members, roundResult?.forfeitedMemberId) === 1 ||
    seatForMemberId(members, roundResult?.forfeitedMemberId) === 2
      ? (seatForMemberId(members, roundResult?.forfeitedMemberId) as 1 | 2)
      : null;
  const winnerSlot =
    seatForMemberId(members, roundResult?.winnerMemberId) ?? null;
  const hasDetails = Boolean(match || roundClock || riskAction);
  const turnState = relayTurnState({
    currentActor,
    ended,
    isMyActiveTurn,
    round,
    viewerRole,
  });
  const quotaLabel =
    viewerRole === "spectator"
      ? `当前玩家可空过 ${currentSkipRemaining}/${maxSkips} 次`
      : `可空过 ${mySkipRemaining}/${maxSkips} 次`;

  return (
    <section className="multiplayer-match-page relay-match-page">
      <Paper
        animateOnMount={false}
        as="div"
        className="multiplayer-match-summary relay-match-summary"
        elevation="sm"
        folded={false}
        pattern={false}
        sticker={false}
        unfoldOnHover={false}
      >
        <div className="multiplayer-match-summary-primary relay-turn-primary">
          <span className="multiplayer-match-mode">
            {MULTIPLAYER_MODE_LABELS.relay} ·{" "}
            {ROOM_FORMAT_SHORT[format as keyof typeof ROOM_FORMAT_SHORT] ??
              format}
          </span>
          <div
            aria-atomic="true"
            aria-live="polite"
            className="relay-turn-state"
            role="status"
          >
            <h2>{turnState.heading}</h2>
            <p>{turnState.support}</p>
          </div>
          {handClock ? (
            <time
              aria-label={`本手剩余时间 ${handClock}`}
              className="multiplayer-match-clock relay-turn-clock tabular-nums"
              role="timer"
            >
              <small>本手剩余</small>
              {handClock}
            </time>
          ) : null}
          {hasDetails ? (
            <PaperButton
              ariaControls={detailsId}
              ariaExpanded={mobileDetailsOpen}
              ariaLabel={mobileDetailsOpen ? "收起接力信息" : "展开接力信息"}
              className="multiplayer-match-summary-toggle"
              compact
              folded={false}
              iconOnly
              onClick={() => setMobileDetailsOpen((open) => !open)}
              title={mobileDetailsOpen ? "收起接力信息" : "展开接力信息"}
            >
              <ChevronDown
                aria-hidden="true"
                className={mobileDetailsOpen ? "rotate-180" : ""}
                size={18}
              />
            </PaperButton>
          ) : null}
        </div>

        {match ? (
          <div className="multiplayer-match-score-row">
            <MemberScoreStrip
              label="当前比分"
              members={members}
              scores={roundResult?.scores ?? match.scores}
              winnerMemberId={roundResult?.winnerMemberId}
            />
          </div>
        ) : null}

        {isPlaying && turnAction ? (
          <div className="relay-turn-action-row">
            <span>{quotaLabel}</span>
            {turnAction}
          </div>
        ) : null}

        {hasDetails ? (
          <div
            className="multiplayer-match-summary-details relay-match-details"
            data-open={mobileDetailsOpen ? "true" : "false"}
            id={detailsId}
          >
            <div className="relay-round-meta">
              <span>
                {match
                  ? `第 ${roundResult?.roundIndex ?? match.roundIndex} 局${
                      match.targetWins > 1
                        ? ` · 先胜 ${match.targetWins} 局`
                        : ""
                    }`
                  : "等待双方准备"}
              </span>
              {roundClock ? (
                <time
                  aria-label={`本局剩余时间 ${roundClock}`}
                  className="relay-round-clock tabular-nums"
                  role="timer"
                >
                  本局剩余 {roundClock}
                </time>
              ) : null}
              {isPlaying && !turnAction ? (
                <span className="relay-skip-quota">{quotaLabel}</span>
              ) : null}
            </div>
            {riskAction ? (
              <div className="relay-risk-actions">{riskAction}</div>
            ) : null}
          </div>
        ) : null}
      </Paper>

      <section className="relay-ledger-section">
        <SectionHeading
          className="relay-ledger-heading"
          description={
            hasUnlimitedTurns
              ? "无次数限制"
              : `已完成 ${rows.length} / ${maxTurnsPerPlayer * 2} 手`
          }
          title={ended ? "本局记录" : "接力记录"}
        />
        <Paper
          animateOnMount={false}
          as="div"
          className="paper-data-table relay-turn-ledger"
          elevation="sm"
          folded={false}
          pattern={false}
          sticker={false}
          unfoldOnHover={false}
        >
          <ol
            aria-label="接力回合记录"
            className="relay-turn-timeline paper-data-table-body"
          >
            {rows.map((row) => (
              <RelayTurnEntry
                fields={fields}
                key={row.index}
                members={members}
                mySlot={mySlot}
                row={row}
                viewerRole={viewerRole}
                winnerSlot={winnerSlot}
              />
            ))}
            {forfeitedSlot ? (
              <RelayForfeitEntry
                members={members}
                mySlot={mySlot}
                slot={forfeitedSlot}
                viewerRole={viewerRole}
              />
            ) : null}
            {isPlaying && currentSlot ? (
              <RelayCurrentHandoff
                clock={handClock}
                label={memberLabel(currentSlot, members, viewerRole, mySlot)}
              />
            ) : null}
            {rows.length === 0 && !isPlaying && !forfeitedSlot ? (
              <li className="relay-turn-empty" role="status">
                等待第一手猜测。
              </li>
            ) : null}
          </ol>
        </Paper>
      </section>
    </section>
  );
}

function relayTurnState({
  currentActor,
  ended,
  isMyActiveTurn,
  round,
  viewerRole,
}: {
  currentActor: string | null;
  ended: boolean;
  isMyActiveTurn: boolean;
  round: RoundView | null;
  viewerRole: "player" | "spectator";
}) {
  if (ended) {
    return { heading: "本局已结束", support: "结果已写入复盘记录" };
  }
  if (round?.status === "countdown") {
    return { heading: "本局即将开始", support: "等待服务端开始信号" };
  }
  if (round?.status !== "playing" || !currentActor) {
    return { heading: "下一局准备中", support: "等待房间同步下一局" };
  }
  if (isMyActiveTurn) {
    return { heading: "轮到你", support: "请在本手结束前猜测或空过" };
  }
  if (viewerRole === "spectator") {
    return { heading: `${currentActor}行动中`, support: "下一手将自动交接" };
  }
  return { heading: `等待 ${currentActor}`, support: "对方行动后会自动交接" };
}

function memberLabel(
  slot: number,
  members: readonly MemberView[],
  viewerRole: "player" | "spectator",
  mySlot: 1 | 2,
) {
  const name =
    members.find((member) => member.seat === slot)?.displayName ??
    `玩家 ${slot}`;
  return `P${slot} ${name}${
    viewerRole === "player" && slot === mySlot ? "（我）" : ""
  }`;
}

function RelayCurrentHandoff({
  clock,
  label,
}: {
  clock: string | null;
  label: string;
}) {
  return (
    <li aria-current="step" className="relay-current-handoff">
      <span>当前交接</span>
      <strong>轮到 {label}</strong>
      <span>{clock ? `本手 ${clock}` : "等待行动"}</span>
    </li>
  );
}

function RelayForfeitEntry({
  slot,
  mySlot,
  members,
  viewerRole,
}: {
  slot: 1 | 2;
  mySlot: 1 | 2;
  members: MemberView[];
  viewerRole: "player" | "spectator";
}) {
  const owner = memberLabel(slot, members, viewerRole, mySlot);
  return (
    <li
      className="relay-turn-entry paper-data-table-entry"
      data-paper-row-tone="danger"
    >
      <div className="relay-turn-row paper-data-table-row">
        <span className="relay-turn-index">本局结束</span>
        <strong className="relay-turn-owner">{owner}</strong>
        <span className="relay-turn-kind">放弃</span>
      </div>
      <p className="relay-turn-detail">该玩家放弃，本局已结束。</p>
    </li>
  );
}

function RelayTurnEntry({
  row,
  mySlot,
  members,
  fields,
  viewerRole,
  winnerSlot,
}: {
  row: RelayTurnRow;
  mySlot: 1 | 2;
  members: MemberView[];
  fields: readonly GuessField[];
  viewerRole: "player" | "spectator";
  winnerSlot: number | null;
}) {
  const owner = memberLabel(row.seat, members, viewerRole, mySlot);
  const isWinnerGuess =
    row.kind === "guess" && row.guess?.isCorrect && row.seat === winnerSlot;
  const kindLabel =
    row.kind === "guess"
      ? "猜测"
      : row.kind === "pass"
        ? "主动空过"
        : "超时空过";
  const tone = isWinnerGuess
    ? "success"
    : row.kind === "pass"
      ? "warning"
      : row.kind === "timeout"
        ? "neutral"
        : undefined;

  return (
    <li
      className="relay-turn-entry paper-data-table-entry"
      data-paper-row-tone={tone}
    >
      <div className="relay-turn-row paper-data-table-row">
        <span className="relay-turn-index">第 {row.index} 手</span>
        <strong className="relay-turn-owner">{owner}</strong>
        <span className="relay-turn-kind">{kindLabel}</span>
      </div>
      {row.kind === "guess" && row.guess ? (
        <div className="relay-turn-detail">
          <div className="relay-turn-character">
            <CharacterAvatar
              avatarUrl={row.guess.guessAvatarUrl}
              className="!size-7 shrink-0"
              initials={row.guess.guessName.slice(0, 2)}
              name={row.guess.guessName}
            />
            <strong>{row.guess.guessName}</strong>
            {row.guess.isCorrect ? <span>命中</span> : null}
          </div>
          <div className="relay-turn-feedback-grid">
            {feedbackForFields(row.guess.feedback, fields).map(
              (feedback, index) => (
                <div
                  className={`paper-tinted-cell feedback-cell feedback-cell-${feedback.status} relay-turn-feedback-cell`}
                  key={fields[index]?.key ?? index}
                >
                  <span className="relay-turn-field-label">
                    {fields[index]?.label ?? feedback.label}
                  </span>
                  <span
                    className={`feedback feedback-${feedback.status}`}
                    title={STATUS_LABEL[feedback.status]}
                  >
                    <b>
                      <FeedbackStatusIcon
                        decorative={false}
                        status={feedback.status}
                      />
                    </b>
                    <span>{feedback.displayValue.join("、")}</span>
                  </span>
                </div>
              ),
            )}
          </div>
        </div>
      ) : (
        <p className="relay-turn-detail">
          {row.kind === "pass"
            ? `${owner}主动空过本手。`
            : `${owner}本手超时，已自动交接。`}
        </p>
      )}
    </li>
  );
}

function feedbackForFields(
  feedback: NonNullable<RelayTurnRow["guess"]>["feedback"] | undefined,
  fields: readonly GuessField[],
) {
  const fallback = fields.map(
    (_, index) =>
      feedback?.[index] ?? {
        field: fields[index]?.key,
        label: fields[index]?.label ?? "",
        status: "unknown" as const,
        symbol: "?" as const,
        displayValue: [],
      },
  );
  if (!feedback?.some((item) => item.field)) return fallback;

  const byField = new Map(feedback.map((item) => [item.field, item]));
  if (!fields.every((field) => byField.has(field.key))) return fallback;
  return fields.map((field) => byField.get(field.key)!);
}
