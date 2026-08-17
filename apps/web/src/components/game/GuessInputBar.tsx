"use client";

// 底部固定搜索条（对局中）：输入框 fixed 于页面底部、水平居中；
// 建议下拉向上展开（不遮挡棋盘）；猜测随建议点击提交（与单人一致）。
import { X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { CharacterAvatar } from "./CharacterAvatar";
import { FeedbackLegendButton } from "./FeedbackLegendButton";
import { useCharacterSearch } from "../../hooks/useCharacterSearch";
import { Paper, PaperButton, PaperSearchInput } from "@/components/paper";

const GAME_SEARCH_RESULT_LIMIT = 12;

export function GuessInputBar({
  onGuess,
  disabled,
  catalogVersion,
  guessedIds,
  statusMessage,
}: {
  onGuess: (guessId: string) => void;
  disabled?: boolean;
  catalogVersion?: string;
  guessedIds: ReadonlySet<string>;
  statusMessage?: string | null;
}) {
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const { results, loading, error } = useCharacterSearch(query, {
    enabled: Boolean(catalogVersion) && !disabled,
    limit: GAME_SEARCH_RESULT_LIMIT,
    version: catalogVersion,
  });
  const filtered = results.filter((r) => !guessedIds.has(r.id));
  const showSuggestions =
    query.trim().length > 0 && !loading && filtered.length > 0;

  // 键盘指针：默认指向第一项；查询/结果变化时回到第一项
  const [highlightIndex, setHighlightIndex] = useState(0);
  useEffect(() => {
    setHighlightIndex(0);
  }, [query, results]);

  useEffect(() => {
    if (disabled) setQuery("");
  }, [disabled]);

  const submit = (guessId: string) => {
    onGuess(guessId);
    setQuery("");
    setHighlightIndex(0);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || disabled) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((i) => (i + 1) % filtered.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = filtered[highlightIndex];
      if (item) submit(item.id);
    }
  };

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 backdrop-blur"
      data-guess-input-bar
    >
      <Paper
        animateOnMount={false}
        as="div"
        className="game-action-bar-surface w-full px-4 py-3"
        elevation="lg"
        folded={false}
        pattern={false}
        sticker={false}
        unfoldOnHover={false}
      >
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
            <PaperSearchInput
              aria-activedescendant={
                showSuggestions
                  ? `${listboxId}-option-${highlightIndex}`
                  : undefined
              }
              aria-controls={listboxId}
              aria-expanded={showSuggestions}
              ariaLabel="搜索角色"
              className="w-full"
              disabled={disabled}
              folded={false}
              endAdornment={
                query ? (
                  <PaperButton
                    ariaLabel="清空搜索"
                    compact
                    folded={false}
                    iconOnly
                    onClick={() => setQuery("")}
                  >
                    <X size={14} aria-hidden="true" />
                  </PaperButton>
                ) : null
              }
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                disabled
                  ? (statusMessage ?? "等待当前轮次……")
                  : "搜索角色并选择提交……（↑↓ 选择，Enter 提交）"
              }
              role="combobox"
              value={query}
            />
            {error && (
              <p className="mt-1 text-[0.75rem] text-vermilion">{error}</p>
            )}
            {showSuggestions && (
              <Paper
                animateOnMount={false}
                as="div"
                className="absolute right-0 bottom-full left-0 mb-2 max-h-44 overflow-y-auto"
                elevation="lg"
                folded={false}
                sticker={false}
                pattern={false}
                unfoldOnHover={false}
              >
                <ul
                  className="paper-data-table-body"
                  id={listboxId}
                  role="listbox"
                >
                  {filtered.map((result, index) => (
                    <li className="paper-data-table-entry" key={result.id}>
                      <button
                        type="button"
                        id={`${listboxId}-option-${index}`}
                        disabled={disabled}
                        aria-selected={highlightIndex === index}
                        role="option"
                        tabIndex={-1}
                        onClick={() => submit(result.id)}
                        onMouseEnter={() => setHighlightIndex(index)}
                        className="paper-data-table-row text-[0.82rem]"
                      >
                        <span className="flex w-full items-center gap-2 text-left">
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
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Paper>
            )}
          </div>
          <FeedbackLegendButton className="shrink-0" placement="above" />
        </div>
      </Paper>
    </div>
  );
}
