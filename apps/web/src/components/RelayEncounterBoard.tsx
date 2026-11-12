"use client";

import type {
  GuessField,
  RelayEncounterView,
  RelayTurnRow,
} from "@touhouflandre/shared";
import { isUnlimitedGuessLimit } from "@touhouflandre/shared";
import type { components } from "../generated/api";
import { CharacterAvatar } from "./game/CharacterAvatar";
import { FeedbackStatusIcon } from "./game/FeedbackStatusIcon";
import { STATUS_LABEL } from "./game/GuessTable";
import { Paper } from "@/components/paper";

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
      className="relay-encounter-region"
      data-relay-board={encounter.encounterId}
      aria-labelledby={`relay-board-${encounter.encounterId}`}
    >
      <Paper
        animateOnMount={false}
        as="div"
        className="paper-data-table relay-original-board"
        elevation="sm"
        folded={false}
        pattern={false}
        sticker={false}
        unfoldOnHover={false}
      >
        <header className="relay-original-board-heading">
          <h2 id={`relay-board-${encounter.encounterId}`}>{title}</h2>
          <span>
            {unlimited
              ? "无次数限制"
              : `已消耗 ${encounter.rows.length}/${maximumTurns * 2} 手`}
          </span>
        </header>
        {encounter.status === "ended" && encounter.answer ? (
          <p className="mb-2 rounded bg-jade-soft px-2 py-1 text-[0.72rem] font-bold text-jade">
            答案：{encounter.answer.name} · {encounter.answer.workTitle}
          </p>
        ) : null}
        <div
          className="relay-original-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="接力回合记录"
        >
          <table className="relay-original-table" aria-label="共享接力棋盘">
            <thead className="paper-data-table-header">
              <tr className="paper-data-table-row">
                <th>回合</th>
                <th>角色</th>
                {fields.map((field) => (
                  <th key={field.key}>{field.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="paper-data-table-body">
              {encounter.rows.length === 0 ? (
                <tr className="paper-data-table-row">
                  <td
                    colSpan={fields.length + 2}
                    className="relay-original-empty"
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
      </Paper>
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
          ?.displayName ?? "玩家";
      return `${name}(P${participant.seat})`;
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
  const owner = `${member?.displayName ?? "玩家"}(P${row.seat})`;
  if (row.kind !== "guess" || !row.guess) {
    return (
      <tr className="paper-data-table-row">
        <th scope="row">
          第 {row.index} 手 · {owner}
        </th>
        <td colSpan={fields.length + 1}>
          <span className="relay-original-pass" data-kind={row.kind}>
            {row.kind === "pass" ? "主动空过" : "超时空过"}
          </span>
        </td>
      </tr>
    );
  }

  const feedback = feedbackForFields(row.guess.feedback, fields);
  return (
    <tr
      className="paper-data-table-row"
      data-paper-row-tone={
        row.memberId === winnerMemberId && row.guess.isCorrect
          ? "success"
          : undefined
      }
      data-match-kind={row.guess.matchKind}
    >
      <th scope="row">
        第 {row.index} 手 · {owner}
      </th>
      <th scope="row">
        <span className="relay-original-character">
          <CharacterAvatar
            avatarUrl={row.guess.guessAvatarUrl}
            name={row.guess.guessName}
            initials={row.guess.guessName.slice(0, 1)}
            className="!size-5 shrink-0"
          />
          <span className="min-w-0 overflow-wrap-anywhere">
            {row.guess.guessName}
            {row.guess.isCorrect ? (
              <span className="relay-original-hit">
                {row.guess.matchKind === "equivalent" ? "等价命中" : "命中"}
              </span>
            ) : null}
          </span>
        </span>
      </th>
      {feedback.map((field, index) => (
        <td key={fields[index]?.key ?? index}>
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
