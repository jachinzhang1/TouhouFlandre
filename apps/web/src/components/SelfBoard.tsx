"use client";

// 自视角棋盘（08 §10.2）：猜测表格（列标签一次于表头，复用单人 feedback 语义类）。
// 搜索输入已移至底部固定条 GuessInputBar；反馈全部来自 API/事件，客户端不自行计算。
import { useMemo } from "react";
import type { GuessResult } from "@touhouflandre/shared";
import { GuessTable, type GuessRow } from "./GuessTable";

export function SelfBoard({
  guesses,
  playing,
}: {
  guesses: GuessResult[];
  playing: boolean;
}) {
  const rows: GuessRow[] = useMemo(
    () =>
      guesses.map((guess) => ({
        key: guess.guessId,
        name: guess.guessName,
        avatarUrl: guess.guessAvatarUrl,
        isCorrect: guess.isCorrect,
        cells: guess.feedback.map((field) => ({
          status: field.status,
          symbol: field.symbol,
          value: field.displayValue.join("、"),
        })),
      })),
    [guesses],
  );

  return (
    <GuessTable
      title="我"
      subtitle={`已猜 ${guesses.length}${playing ? " 局 · 竞速中" : ""}`}
      rows={rows}
      emptyLabel={playing ? "搜索角色开始猜测。" : "本局尚未猜测。"}
    />
  );
}
