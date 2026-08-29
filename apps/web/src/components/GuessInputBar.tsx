"use client";

// 多人底部操作条：固定定位由 MultiplayerBottomDockProvider 统一负责；
// 建议向上展开，猜测随建议点击提交（与单人一致）。
import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CharacterAvatar } from "./CharacterAvatar";
import { FeedbackLegendButton } from "./FeedbackLegendButton";
import {
  useCharacterSearch,
  type MultiplayerCharacterSearchContext,
} from "../hooks/useCharacterSearch";

const GAME_SEARCH_RESULT_LIMIT = 12;

export function GuessInputBar({
  onGuess,
  disabled,
  searchContext,
  guessedIds,
  statusMessage,
}: {
  onGuess: (guessId: string) => Promise<boolean>;
  disabled?: boolean;
  searchContext?: MultiplayerCharacterSearchContext;
  guessedIds: ReadonlySet<string>;
  statusMessage?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [restoreFocusRequested, setRestoreFocusRequested] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const { results, loading, error } = useCharacterSearch(query, {
    enabled: Boolean(searchContext) && !disabled && !submitting,
    context: searchContext,
    limit: GAME_SEARCH_RESULT_LIMIT,
  });
  const filtered = results.filter((r) => !guessedIds.has(r.id));
  const showSuggestions =
    query.trim().length > 0 && !loading && !submitting && filtered.length > 0;
  const showSearchLoading = loading && !disabled && !submitting;

  // 键盘指针：默认指向第一项；查询/结果变化时回到第一项
  const [highlightIndex, setHighlightIndex] = useState(0);
  useEffect(() => {
    setHighlightIndex(0);
  }, [query, results]);

  useEffect(() => {
    if (disabled) setQuery("");
  }, [disabled]);

  useEffect(() => {
    if (!restoreFocusRequested || disabled || submitting) return;
    const timeout = window.setTimeout(() => {
      inputRef.current?.focus();
      setRestoreFocusRequested(false);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [disabled, restoreFocusRequested, submitting]);

  const submit = async (guessId: string, restoreFocus = false) => {
    if (disabled || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    if (restoreFocus) setRestoreFocusRequested(true);
    try {
      if (await onGuess(guessId)) {
        setQuery("");
        setHighlightIndex(0);
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || disabled || submitting) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((i) => (i + 1) % filtered.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = filtered[highlightIndex];
      if (item) void submit(item.id, true);
    }
  };

  return (
    <div data-guess-input-bar className="px-4 py-3">
      {statusMessage ? (
        <p
          className="mx-auto mb-2 w-full max-w-[720px] text-[0.78rem] font-bold text-vermilion"
          role="status"
        >
          {statusMessage}
        </p>
      ) : null}
      <div className="mx-auto flex w-full max-w-[720px] items-start gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-soft"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled || submitting}
            placeholder={
              disabled
                ? (statusMessage ?? "等待当前轮次……")
                : submitting
                  ? "正在提交……"
                  : "搜索角色并选择提交……（↑↓ 选择，Enter 提交）"
            }
            aria-label="搜索角色"
            aria-activedescendant={
              showSuggestions ? `suggestion-${highlightIndex}` : undefined
            }
            aria-expanded={showSuggestions}
            role="combobox"
            className="w-full rounded-[6px] border border-line-strong bg-paper py-2 pr-8 pl-8 text-[0.85rem] outline-none focus:border-vermilion focus:ring-0 focus:shadow-none focus-visible:ring-0 focus-visible:shadow-none disabled:cursor-not-allowed disabled:bg-paper-muted disabled:text-ink-soft"
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
          {error && (
            <p className="mt-1 text-[0.75rem] text-vermilion">{error}</p>
          )}
          {showSearchLoading && (
            <p className="mt-1 text-[0.75rem] text-ink-soft" role="status">
              正在加载搜索索引
            </p>
          )}
          {showSuggestions && (
            <ul className="absolute right-0 bottom-full left-0 z-40 mb-2 max-h-44 overflow-y-auto rounded-[6px] border border-line bg-paper-muted shadow-lg">
              {filtered.map((result, index) => (
                <li key={result.id}>
                  <button
                    type="button"
                    id={`suggestion-${index}`}
                    disabled={disabled || submitting}
                    onClick={() => void submit(result.id)}
                    onMouseEnter={() => setHighlightIndex(index)}
                    className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[0.82rem] disabled:opacity-50 ${
                      highlightIndex === index
                        ? "bg-vermilion-soft"
                        : "hover:bg-vermilion-soft"
                    }`}
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
        <FeedbackLegendButton className="shrink-0" placement="above" />
      </div>
    </div>
  );
}
