"use client";

// 自视角棋盘（08 §10.2）：搜索框 + 反馈表（复用单人模式语义类）；
// 猜测必须从搜索结果选择；反馈全部来自 API/事件，客户端不自行计算。
import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { FeedbackStatus, GuessResult } from "@touhouflandre/shared";
import { CharacterAvatar } from "./CharacterAvatar";
import { useCharacterSearch } from "../hooks/useCharacterSearch";

const GAME_SEARCH_RESULT_LIMIT = 12;

const feedbackClass = (status: FeedbackStatus) =>
  `feedback feedback-${status}`;

function GuessRow({ guess }: { guess: GuessResult }) {
  return (
    <div className="rounded-[6px] border border-line bg-paper-muted p-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <CharacterAvatar avatarUrl={guess.guessAvatarUrl} name={guess.guessName} initials={guess.guessName.slice(0, 1)} className="!size-[22px]" />
        <span className="text-[0.82rem] font-semibold">{guess.guessName}</span>
        {guess.isCorrect && (
          <span className="rounded bg-jade-soft px-1.5 py-0.5 text-[0.68rem] font-bold text-jade">
            命中
          </span>
        )}
      </div>
      <div className="grid grid-cols-6 gap-1 max-[680px]:grid-cols-3">
        {guess.feedback.map((field) => (
          <div
            key={field.field}
            className={feedbackClass(field.status)}
            title={`${field.label}：${field.displayValue.join("、")}`}
          >
            <span className="feedback-field">{field.label}</span>
            <span className="feedback-value">
              {field.symbol} {field.displayValue.join("、")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SelfBoard({
  guesses,
  playing,
  onGuess,
  disabled,
}: {
  guesses: GuessResult[];
  playing: boolean;
  onGuess: (guessId: string) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const { results, loading, error } = useCharacterSearch(query, {
    limit: GAME_SEARCH_RESULT_LIMIT,
  });

  const filtered = useMemo(() => {
    const guessed = new Set(guesses.map((g) => g.guessId));
    return results.filter((r) => !guessed.has(r.id));
  }, [results, guesses]);

  return (
    <div className="rounded-[6px] border border-line bg-paper p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="m-0 text-[0.8rem] font-bold text-ink-soft">我</h3>
        <span className="text-[0.72rem] text-ink-soft">
          已猜 {guesses.length}
          {playing ? " 局 · 竞速中" : ""}
        </span>
      </div>

      {playing && (
        <div className="mb-3">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-soft"
              aria-hidden="true"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索角色并选择提交……"
              aria-label="搜索角色"
              className="w-full rounded-[6px] border border-line-strong bg-paper py-2 pr-8 pl-8 text-[0.85rem] outline-none focus:border-vermilion"
            />
            {query && (
              <button
                type="button"
                aria-label="清空搜索"
                onClick={() => setQuery("")}
                className="absolute top-1/2 right-2 -translate-y-1/2 text-ink-soft"
              >
                <X size={14} />
              </button>
            )}
          </div>
          {error && <p className="mt-1 text-[0.75rem] text-vermilion">{error}</p>}
          {loading && (
            <p className="mt-1 text-[0.75rem] text-ink-soft">搜索中……</p>
          )}
          {query && !loading && filtered.length === 0 && (
            <p className="mt-1 text-[0.75rem] text-ink-soft">没有匹配的角色。</p>
          )}
          {filtered.length > 0 && (
            <ul className="mt-2 max-h-44 overflow-y-auto rounded-[6px] border border-line bg-paper-muted">
              {filtered.map((result) => (
                <li key={result.id}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      onGuess(result.id);
                      setQuery("");
                    }}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[0.82rem] hover:bg-vermilion-soft disabled:opacity-50"
                  >
                    <CharacterAvatar
                      avatarUrl={result.avatarUrl}
                      name={result.name}
                      initials={result.name.slice(0, 1)}
                      className="!size-[20px]"
                    />
                    <span className="font-medium">{result.name}</span>
                    <span className="ml-auto text-[0.72rem] text-ink-soft">
                      {result.firstAppearance.workTitle}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-2">
        {guesses.length === 0 && (
          <p className="m-0 py-2 text-center text-[0.8rem] text-ink-soft">
            {playing ? "搜索角色开始猜测。" : "本局尚未猜测。"}
          </p>
        )}
        {guesses.map((guess) => (
          <GuessRow key={guess.guessId} guess={guess} />
        ))}
      </div>
    </div>
  );
}
