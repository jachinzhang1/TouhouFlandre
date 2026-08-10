"use client";

// 自视角棋盘（08 §10.2）：猜测表格（列标签一次于表头，复用单人 feedback 语义类）。
// 搜索输入已移至底部固定条 GuessInputBar；反馈全部来自 API/事件，客户端不自行计算。
import { useMemo } from "react";
import type { GuessField, GuessResult } from "@touhouflandre/shared";
import { GuessTable, type GuessRow } from "./GuessTable";

export function SelfBoard({
  guesses,
  playing,
  maxGuesses,
  fields,
}: {
  guesses: GuessResult[];
  playing: boolean;
  maxGuesses?: number;
  fields?: readonly GuessField[];
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
          value: field.displayValue.join("、"),
        })),
      })),
    [guesses],
  );
  const guessCountLabel = maxGuesses
    ? `${guesses.length}/${maxGuesses}`
    : `${guesses.length}`;

  return (
    <GuessTable
      title="我"
      subtitle={`已猜 ${guessCountLabel} 手${playing ? " · 竞速中" : ""}`}
      rows={rows}
      emptyLabel={playing ? "搜索角色开始猜测。" : "本局尚未猜测。"}
      fields={fields}
    />
  );
}
