"use client";

// 对手匿名矩阵（08 §4.5/§10.4）：只渲染状态色块，无名称/标签/值；
// 颜色序列与自视角/单人一致（统一 feedback feedback-{status} 语义类，同色同高）。
// 单元格 role="img" + aria-label 携带状态名（颜色不唯一表达，08 §10.4）。
import type { components } from "../generated/api";
import type { GuessField } from "@touhouflandre/shared";
import { GuessTable, type GuessRow } from "./GuessTable";

type OpponentRow = components["schemas"]["OpponentRow"];

export function OpponentBoard({ rows, fields }: { rows: OpponentRow[]; fields?: readonly GuessField[] }) {
  const tableRows: GuessRow[] = rows.map((row) => ({
    key: String(row.index),
    cells: row.statuses.map((status) => ({
      status,
      // 匿名：不携带值
    })),
  }));

  return (
    <GuessTable
      title="对手"
      variant="opponent"
      rows={tableRows}
      emptyLabel="等待对方猜测……"
      fields={fields}
    />
  );
}
