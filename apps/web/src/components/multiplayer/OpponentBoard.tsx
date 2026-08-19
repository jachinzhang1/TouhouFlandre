"use client";

// 对手匿名棋盘：复用单人台账几何，只渲染状态，不公开角色名、标签或值。
// 每个匿名单元格仍以 role="img" + aria-label 表达状态，避免只靠颜色传意。
import type { components } from "../../generated/api";
import {
  CHARACTER_GUESS_FIELDS,
  type GuessField,
  type GuessFieldKey,
} from "@touhouflandre/shared";
import { GuessTable, type GuessRow } from "../game/GuessTable";

type OpponentRow = components["schemas"]["OpponentRow"];

export function OpponentBoard({
  title = "对手棋盘",
  rows,
  fields,
  showHeading = true,
  fieldOrder,
}: {
  title?: string;
  rows: OpponentRow[];
  fields?: readonly GuessField[];
  showHeading?: boolean;
  fieldOrder?: readonly GuessFieldKey[];
}) {
  const displayFields = fields ?? CHARACTER_GUESS_FIELDS;
  const tableRows: GuessRow[] = rows.map((row) => ({
    key: String(row.index),
    cells: row.statuses.map((status, index) => ({
      field: fieldOrder?.[index],
      status,
      // 匿名：不携带值
    })),
  }));

  return (
    <GuessTable
      title={showHeading ? title : undefined}
      subtitle={
        showHeading
          ? "仅显示反馈状态，具体角色与属性值将在局末揭示。"
          : undefined
      }
      variant="opponent"
      rows={tableRows}
      emptyLabel="等待对方猜测……"
      fields={displayFields}
    />
  );
}
