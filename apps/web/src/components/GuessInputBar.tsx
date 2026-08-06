"use client";

// 底部固定搜索条（对局中）：输入框 fixed 于页面底部、水平居中；
// 建议下拉向上展开（不遮挡棋盘）；猜测随建议点击提交（与单人一致）。
import { Search, X } from "lucide-react";
import { useState } from "react";
import { CharacterAvatar } from "./CharacterAvatar";
import { useCharacterSearch } from "../hooks/useCharacterSearch";

const GAME_SEARCH_RESULT_LIMIT = 12;

export function GuessInputBar({
  onGuess,
  disabled,
  catalogVersion,
  guessedIds,
}: {
  onGuess: (guessId: string) => void;
  disabled?: boolean;
  catalogVersion?: string;
  guessedIds: ReadonlySet<string>;
}) {
  const [query, setQuery] = useState("");
  const { results, loading, error } = useCharacterSearch(query, {
    limit: GAME_SEARCH_RESULT_LIMIT,
    version: catalogVersion,
  });
  const filtered = results.filter((r) => !guessedIds.has(r.id));
  const showSuggestions =
    query.trim().length > 0 && !loading && filtered.length > 0;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur">
      <div className="relative mx-auto w-full max-w-[560px]">
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
        {error && <p className="mt-1 text-[0.75rem] text-vermilion">{error}</p>}
        {showSuggestions && (
          <ul className="absolute right-0 bottom-full left-0 mb-2 max-h-44 overflow-y-auto rounded-[6px] border border-line bg-paper-muted shadow-lg">
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
    </div>
  );
}
