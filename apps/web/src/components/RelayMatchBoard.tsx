"use client";

import type { ReactNode } from "react";
import type { RoundEndedPayload } from "@touhouflandre/shared";
import {
  CHARACTER_GUESS_FIELDS,
  isUnlimitedGuessLimit,
  type GuessField,
} from "@touhouflandre/shared";
import type { components } from "../generated/api";
import type { RoomUiState } from "../hooks/useRoom";
import {
  countRelaySkips,
  MULTIPLAYER_MODE_LABELS,
  relaySkipRemaining,
  ROOM_FORMAT_SHORT,
} from "../domain/multiRoom";
import { useRoomClock, formatRemaining } from "../hooks/useRoomClock";
import {
  seatForMemberId,
  sortMembersBySeat,
} from "../domain/memberCollections";
import { CharacterAvatar } from "./CharacterAvatar";
import { FeedbackStatusIcon } from "./FeedbackStatusIcon";
import { STATUS_LABEL } from "./GuessTable";

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
  roundActions,
  fields = CHARACTER_GUESS_FIELDS,
  viewerRole = "player",
}: {
  format: string;
  match: MatchView | null;
  round: RoundView | null;
  members: MemberView[];
  mySlot: 1 | 2;
  roundResult: RoundEndedPayload | null;
  roundActions?: ReactNode;
  fields?: readonly GuessField[];
  viewerRole?: "player" | "spectator";
}) {
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
  const currentMember = members.find((member) => member.seat === currentSlot);
  const currentLabel = currentSlot
    ? viewerRole === "player" && currentSlot === mySlot
      ? "我"
      : (currentMember?.displayName ?? `玩家 ${currentSlot}`)
    : "等待结算";
  const isMyActiveTurn =
    viewerRole === "player" &&
    round?.status === "playing" &&
    !ended &&
    round.turnSeat === mySlot;
  const forfeitedSlot =
    seatForMemberId(members, roundResult?.forfeitedMemberId) === 1 ||
    seatForMemberId(members, roundResult?.forfeitedMemberId) === 2
      ? (seatForMemberId(members, roundResult?.forfeitedMemberId) as 1 | 2)
      : null;
  const winnerSlot =
    seatForMemberId(members, roundResult?.winnerMemberId) ?? null;

  return (
    <section className="px-[18px] pt-5 pb-28">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-line bg-paper px-4 py-2.5 shadow-sm">
        <span className="rounded bg-vermilion-soft px-2 py-0.5 text-[0.72rem] font-black text-vermilion">
          {MULTIPLAYER_MODE_LABELS.relay} ·{" "}
          {ROOM_FORMAT_SHORT[format as keyof typeof ROOM_FORMAT_SHORT] ??
            format}
        </span>
        {match ? (
          <span className="text-[0.95rem] font-black tabular-nums">
            {sortMembersBySeat(roundResult?.scores ?? match.scores)
              .map((score) => score.score)
              .join(" : ")}
          </span>
        ) : (
          <span className="rounded bg-vermilion-soft px-2 py-0.5 text-[0.82rem] font-black text-vermilion">
            等待开始
          </span>
        )}
        <span className="text-[0.75rem] text-ink-soft">
          {match
            ? `第 ${roundResult?.roundIndex ?? match.roundIndex} 局${match.targetWins > 1 ? ` · 先胜 ${match.targetWins} 局` : ""}`
            : "等待双方准备"}
        </span>
        {round && !ended && (
          <span className="text-[0.72rem] text-ink-soft tabular-nums">
            整局 {formatRemaining(roundRemaining)}
          </span>
        )}
      </div>

      <div
        className={`mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-line bg-paper px-4 py-3 shadow-sm ${
          isMyActiveTurn ? "relay-current-turn-active" : ""
        }`}
      >
        {round?.status === "playing" && !ended ? (
          <>
            <p className="m-0 text-[0.82rem] font-semibold text-ink">
              当前轮到 {currentLabel}
              {round.turnDeadline ? (
                <span className="ml-2 text-ink-soft tabular-nums">
                  {formatRemaining(turnRemaining)}
                </span>
              ) : null}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {viewerRole === "spectator" ? (
                <span className="rounded bg-paper-muted px-2 py-1 text-[0.72rem] font-bold text-ink-soft">
                  空过 {currentSkipRemaining}/{maxSkips}
                </span>
              ) : (
                <span className="rounded bg-paper-muted px-2 py-1 text-[0.72rem] font-bold text-ink-soft">
                  我的空过 {mySkipCount}/{maxSkips} · 剩余 {mySkipRemaining}
                </span>
              )}
              {roundActions}
            </div>
          </>
        ) : (
          <p className="m-0 text-[0.82rem] font-semibold text-ink-soft">
            {round?.status === "countdown"
              ? "即将开始"
              : ended
                ? "本局已结束"
                : "等待对局同步"}
          </p>
        )}
      </div>

      <div className="rounded-[6px] border border-line bg-paper p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="m-0 text-[0.8rem] font-bold text-ink-soft">
            共享棋盘
          </h3>
          <span className="text-[0.72rem] text-ink-soft">
            {hasUnlimitedTurns
              ? "无次数限制"
              : `已消耗 ${rows.length} / ${maxTurnsPerPlayer * 2} 手`}
          </span>
        </div>
        <div
          className="overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="接力共享棋盘"
        >
          <table className="w-full min-w-[640px] border-collapse text-[0.78rem]">
            <thead>
              <tr>
                <th className="w-28 border-b border-line bg-paper-muted p-2 text-left text-[0.72rem] font-bold text-ink-soft">
                  回合
                </th>
                <th className="w-28 border-b border-line bg-paper-muted p-2 text-left text-[0.72rem] font-bold text-ink-soft">
                  角色
                </th>
                {fields.map((field) => (
                  <th
                    key={field.key}
                    className="border-b border-line bg-paper-muted p-2 text-left text-[0.72rem] font-bold text-ink-soft"
                  >
                    {field.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !forfeitedSlot ? (
                <tr>
                  <td
                    colSpan={fields.length + 2}
                    className="py-4 text-center text-ink-soft"
                  >
                    等待第一手猜测。
                  </td>
                </tr>
              ) : (
                <>
                  {rows.map((row) => (
                    <RelayTurn
                      key={row.index}
                      row={row}
                      mySlot={mySlot}
                      members={members}
                      fields={fields}
                      viewerRole={viewerRole}
                      winnerSlot={winnerSlot}
                    />
                  ))}
                  {forfeitedSlot ? (
                    <RelayForfeitRow
                      slot={forfeitedSlot}
                      members={members}
                      fields={fields}
                      viewerRole={viewerRole}
                      mySlot={mySlot}
                    />
                  ) : null}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function ownerLabel({
  slot,
  mySlot,
  members,
  viewerRole,
}: {
  slot: number;
  mySlot: 1 | 2;
  members: MemberView[];
  viewerRole: "player" | "spectator";
}) {
  if (viewerRole === "spectator") {
    return (
      members.find((member) => member.seat === slot)?.displayName ??
      `玩家 ${slot}`
    );
  }
  return slot === mySlot ? "我" : "对手";
}

function RelayForfeitRow({
  slot,
  mySlot,
  members,
  fields,
  viewerRole,
}: {
  slot: 1 | 2;
  mySlot: 1 | 2;
  members: MemberView[];
  fields: readonly GuessField[];
  viewerRole: "player" | "spectator";
}) {
  const owner = ownerLabel({ slot, mySlot, members, viewerRole });
  return (
    <tr>
      <th
        scope="row"
        className="border-b border-line p-1.5 text-left font-normal text-ink-soft"
      >
        {owner}
      </th>
      <td colSpan={fields.length + 1} className="border-b border-line p-1.5">
        <span className="inline-flex rounded bg-vermilion-soft px-2 py-1 text-[0.72rem] font-black text-vermilion">
          玩家放弃此局
        </span>
      </td>
    </tr>
  );
}

function RelayTurn({
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
  const owner = ownerLabel({ slot: row.seat, mySlot, members, viewerRole });
  const isWinnerGuess =
    viewerRole === "spectator" &&
    row.kind === "guess" &&
    row.seat === winnerSlot;
  const feedback = feedbackForFields(row.guess?.feedback, fields);

  if (row.kind !== "guess" || !row.guess) {
    const label = row.kind === "pass" ? "主动空过" : "超时空过";
    return (
      <tr>
        <th
          scope="row"
          className="border-b border-line p-1.5 text-left font-normal text-ink-soft"
        >
          第 {row.index} 手 · {owner}
        </th>
        <td colSpan={fields.length + 1} className="border-b border-line p-1.5">
          <span
            className={`inline-flex rounded px-2 py-1 text-[0.72rem] font-bold ${
              row.kind === "pass"
                ? "bg-amber-soft text-amber"
                : "bg-paper-muted text-ink-soft"
            }`}
          >
            {label}
          </span>
        </td>
      </tr>
    );
  }

  return (
    <tr className={isWinnerGuess ? "bg-jade-soft" : undefined}>
      <th
        scope="row"
        className="border-b border-line p-1.5 text-left font-normal text-ink-soft"
      >
        第 {row.index} 手 · {owner}
      </th>
      <th
        scope="row"
        className="border-b border-line p-1.5 align-top text-left font-normal"
      >
        <span className="flex items-center gap-1.5">
          <CharacterAvatar
            avatarUrl={row.guess.guessAvatarUrl}
            name={row.guess.guessName}
            initials={row.guess.guessName.slice(0, 1)}
            className="!size-5 shrink-0"
          />
          <span className="min-w-0 overflow-wrap-anywhere">
            {row.guess.guessName}
            {row.guess.isCorrect ? (
              <span className="ml-1 rounded bg-jade-soft px-1 py-0.5 text-[0.62rem] font-bold text-jade">
                命中
              </span>
            ) : null}
          </span>
        </span>
      </th>
      {feedback.map((field, index) => (
        <td
          key={fields[index]?.key ?? index}
          className="border-b border-line p-1.5 align-top"
        >
          <span
            className={`feedback match-feedback feedback-${field.status}`}
            title={STATUS_LABEL[field.status]}
          >
            <b>
              <FeedbackStatusIcon status={field.status} decorative={false} />
            </b>
            <span>{field.displayValue.join("、")}</span>
          </span>
        </td>
      ))}
    </tr>
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
