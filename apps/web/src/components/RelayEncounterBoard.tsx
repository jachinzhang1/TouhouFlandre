"use client";

import type {
  GuessField,
  RelayEncounterView,
  RelayTurnRow,
} from "@touhouflandre/shared";
import { isUnlimitedGuessLimit } from "@touhouflandre/shared";
import type { components } from "../generated/api";
import { CharacterAvatar } from "./CharacterAvatar";
import { FeedbackStatusIcon } from "./FeedbackStatusIcon";
import { STATUS_LABEL } from "./GuessTable";

type MemberView = components["schemas"]["MemberView"];

export function RelayEncounterBoard({
  encounter,
  members,
  fields,
}: {
  encounter: RelayEncounterView;
  members: readonly MemberView[];
  fields: readonly GuessField[];
}) {
  const title = relayEncounterTitle(encounter, members);
  const maximumTurns = encounter.maxTurnsPerPlayer ?? 0;
  const unlimited = isUnlimitedGuessLimit(maximumTurns);
  return (
    <section
      className="min-h-[360px] rounded-[6px] border border-line bg-paper p-3 shadow-sm"
      data-relay-board={encounter.encounterId}
      aria-labelledby={`relay-board-${encounter.encounterId}`}
    >
      <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h2
          id={`relay-board-${encounter.encounterId}`}
          className="m-0 min-w-0 overflow-wrap-anywhere text-[0.82rem] font-black text-ink"
        >
          {title}
        </h2>
        <span className="shrink-0 text-[0.72rem] text-ink-soft tabular-nums">
          {unlimited
            ? "无次数限制"
            : `已消耗 ${encounter.rows.length}/${maximumTurns * 2} 手`}
        </span>
      </div>
      {encounter.status === "ended" && encounter.answer ? (
        <p className="mb-2 rounded bg-jade-soft px-2 py-1 text-[0.72rem] font-bold text-jade">
          答案：{encounter.answer.name} · {encounter.answer.workCode}
        </p>
      ) : null}
      <div className="max-w-full overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[0.78rem]">
          <thead>
            <tr>
              <th className="w-36 border-b border-line bg-paper-muted p-2 text-left text-[0.72rem] font-bold text-ink-soft">
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
            {encounter.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={fields.length + 2}
                  className="h-24 text-center text-ink-soft"
                >
                  {encounter.status === "ended"
                    ? "本局没有猜测记录。"
                    : "等待第一手猜测。"}
                </td>
              </tr>
            ) : (
              encounter.rows.map((row) => (
                <RelayTurn
                  key={row.index}
                  row={row}
                  members={members}
                  fields={fields}
                  winnerMemberId={encounter.winnerMemberId}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function relayEncounterTitle(
  encounter: Pick<RelayEncounterView, "members">,
  members: readonly MemberView[],
): string {
  return [...encounter.members]
    .sort((left, right) => left.side - right.side)
    .map((participant) => {
      const name =
        members.find((member) => member.memberId === participant.memberId)
          ?.displayName ?? `玩家 ${participant.seat}`;
      return `${name}(${participant.seat})`;
    })
    .join(" vs ");
}

function RelayTurn({
  row,
  members,
  fields,
  winnerMemberId,
}: {
  row: RelayTurnRow;
  members: readonly MemberView[];
  fields: readonly GuessField[];
  winnerMemberId?: string | null;
}) {
  const member = members.find(
    (candidate) => candidate.memberId === row.memberId,
  );
  const owner = `${member?.displayName ?? `玩家 ${row.seat}`}(${row.seat})`;
  if (row.kind !== "guess" || !row.guess) {
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
            className={`inline-flex rounded px-2 py-1 text-[0.72rem] font-bold ${row.kind === "pass" ? "bg-amber-soft text-amber" : "bg-paper-muted text-ink-soft"}`}
          >
            {row.kind === "pass" ? "主动空过" : "超时空过"}
          </span>
        </td>
      </tr>
    );
  }

  const feedback = feedbackForFields(row.guess.feedback, fields);
  return (
    <tr
      className={
        row.memberId === winnerMemberId && row.guess.isCorrect
          ? "bg-jade-soft"
          : undefined
      }
    >
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
  feedback: NonNullable<RelayTurnRow["guess"]>["feedback"],
  fields: readonly GuessField[],
) {
  const fallback = fields.map(
    (_, index) =>
      feedback[index] ?? {
        field: fields[index]?.key,
        label: fields[index]?.label ?? "",
        status: "unknown" as const,
        symbol: "?" as const,
        displayValue: [],
      },
  );
  if (!feedback.some((item) => item.field)) return fallback;
  const byField = new Map(feedback.map((item) => [item.field, item]));
  if (!fields.every((field) => byField.has(field.key))) return fallback;
  return fields.map((field) => byField.get(field.key)!);
}
