"use client";

// 自视角棋盘：把权威猜测结果转换为单人模式台账行；客户端不重新计算反馈。
// 搜索与提交由页面底部的 multiplayer command deck 处理。
import { useMemo } from "react";
import { isUnlimitedGuessLimit } from "@touhouflandre/shared";
import type { GuessField, GuessResult } from "@touhouflandre/shared";
import { GuessTable, type GuessRow } from "../game/GuessTable";

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
  const rows = useMemo<GuessRow[]>(
    () =>
      guesses.map((guess) =>
        guess.kind === "timeout"
          ? {
              key: guess.guessId,
              notice: "超时跳过",
              tone: "danger",
            }
          : {
              key: guess.guessId,
              name: guess.guessName,
              avatarUrl: guess.guessAvatarUrl,
              isCorrect: guess.isCorrect,
              cells: guess.feedback.map((field) => ({
                field: field.field,
                status: field.status,
                value: field.displayValue.join("、"),
              })),
            },
      ),
    [guesses],
  );
  const guessCountLabel = maxGuesses
    ? `${guesses.length}/${maxGuesses}`
    : `${guesses.length}`;
  const subtitle = isUnlimitedGuessLimit(maxGuesses)
    ? `无次数限制${playing ? " · 竞速中" : ""}`
    : `已猜 ${guessCountLabel} 手${playing ? " · 竞速中" : ""}`;

  return (
    <GuessTable
      title="我的棋盘"
      subtitle={subtitle}
      rows={rows}
      emptyLabel={playing ? "搜索角色开始猜测。" : "本局尚未猜测。"}
      fields={fields}
    />
  );
}
