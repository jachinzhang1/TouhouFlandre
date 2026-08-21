"use client";

// 与单人模式一致的“先选择、再提交”猜测组件；定位由多人 command deck 负责。
import { Loader2, Search, Send, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { CharacterAvatar } from "./CharacterAvatar";
import { FeedbackLegendButton } from "./FeedbackLegendButton";
import { useCharacterSearch } from "../../hooks/useCharacterSearch";
import {
  Paper,
  PaperButton,
  PaperSearchInput,
  PaperSegmentGroup,
  PaperSegmentSeparator,
} from "@/components/paper";

const GAME_SEARCH_RESULT_LIMIT = 12;

export function GuessInputBar({
  onGuess,
  disabled,
  catalogVersion,
  preserveDraftWhenDisabled = false,
  statusTone = "warning",
  guessedIds,
  statusMessage,
}: {
  onGuess: (guessId: string) => void | Promise<void>;
  disabled?: boolean;
  catalogVersion?: string;
  guessedIds: ReadonlySet<string>;
  preserveDraftWhenDisabled?: boolean;
  statusTone?: "success" | "warning" | "danger" | "neutral";
  statusMessage?: string | null;
}) {
  const listboxId = useId();
  const headingId = useId();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [restoreFocusRequested, setRestoreFocusRequested] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { results, loading, error } = useCharacterSearch(query, {
    enabled: Boolean(catalogVersion) && !disabled,
    limit: GAME_SEARCH_RESULT_LIMIT,
    version: catalogVersion,
  });
  const selectableResults = results.filter(
    (result) => !guessedIds.has(result.id),
  );
  const hasQuery = query.trim().length > 0;
  const showPopover = hasQuery && !selectedId && !disabled;
  const submitDisabled = Boolean(disabled || !selectedId);

  useEffect(() => {
    setHighlightIndex(0);
  }, [query, results]);

  useEffect(() => {
    if (!disabled || preserveDraftWhenDisabled) return;
    setQuery("");
    setSelectedId("");
  }, [disabled, preserveDraftWhenDisabled]);

  useEffect(() => {
    if (!restoreFocusRequested || disabled) return;
    const timeout = window.setTimeout(() => {
      inputRef.current?.focus();
      setRestoreFocusRequested(false);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [disabled, restoreFocusRequested]);

  const selectResult = (result: (typeof selectableResults)[number]) => {
    setQuery(result.name);
    setSelectedId(result.id);
    setHighlightIndex(0);
  };

  const submitSelected = (restoreFocus = false) => {
    if (submitDisabled) return;
    void onGuess(selectedId);
    setQuery("");
    setSelectedId("");
    setHighlightIndex(0);
    if (restoreFocus) setRestoreFocusRequested(true);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!showPopover || loading || error || selectableResults.length === 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((index) => (index + 1) % selectableResults.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex(
        (index) =>
          (index - 1 + selectableResults.length) % selectableResults.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const result = selectableResults[highlightIndex];
      if (result) selectResult(result);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setQuery("");
      setSelectedId("");
    }
  };

  return (
    <section
      aria-labelledby={headingId}
      className="multiplayer-command-channel multiplayer-guess-bar"
      data-guess-input-bar
    >
      <header className="multiplayer-command-channel-heading">
        <strong id={headingId}>猜测</strong>
        <span>
          {disabled ? (statusMessage ?? "等待当前轮次") : "选择角色后提交"}
        </span>
      </header>
      <div className="multiplayer-guess-composer">
        <FeedbackLegendButton
          className="multiplayer-legend-control"
          placement="above"
        />
        <form
          className="multiplayer-guess-form"
          aria-labelledby={headingId}
          onSubmit={(event) => {
            const restoreFocus = document.activeElement === inputRef.current;
            event.preventDefault();
            submitSelected(restoreFocus);
          }}
        >
          <PaperSegmentGroup
            className="single-game-guess-group multiplayer-guess-group"
            label="猜测操作"
          >
            <div className="search-combobox">
              <PaperSearchInput
                aria-activedescendant={
                  showPopover && selectableResults[highlightIndex]
                    ? `${listboxId}-${selectableResults[highlightIndex].id}`
                    : undefined
                }
                aria-autocomplete="list"
                aria-controls={listboxId}
                aria-expanded={showPopover}
                ariaLabel="搜索角色"
                className="single-game-search-control"
                disabled={disabled}
                inputRef={inputRef}
                folded={false}
                endAdornment={
                  query ? (
                    <PaperButton
                      ariaLabel="清空搜索"
                      compact
                      folded={false}
                      iconOnly
                      onClick={() => {
                        setQuery("");
                        setSelectedId("");
                      }}
                    >
                      <X size={14} aria-hidden="true" />
                    </PaperButton>
                  ) : null
                }
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedId("");
                }}
                onKeyDown={handleKeyDown}
                placeholder={
                  disabled
                    ? (statusMessage ?? "等待当前轮次……")
                    : "输入角色名、别名或初登场作品"
                }
                role="combobox"
                value={query}
              />
              {showPopover ? (
                <Paper
                  animateOnMount={false}
                  as="div"
                  className="multiplayer-guess-suggestions"
                  elevation="lg"
                  folded={false}
                  pattern={false}
                  sticker={false}
                  unfoldOnHover={false}
                >
                  {loading ? (
                    <div className="suggestion-state" role="status">
                      <Loader2 className="spin" size={17} aria-hidden="true" />
                      <span>正在搜索</span>
                    </div>
                  ) : error ? (
                    <div
                      className="suggestion-state suggestion-error"
                      role="alert"
                    >
                      <span>{error}</span>
                    </div>
                  ) : selectableResults.length > 0 ? (
                    <div
                      className="suggestion-list-body"
                      id={listboxId}
                      role="listbox"
                    >
                      {selectableResults.map((result, index) => (
                        <button
                          aria-selected={highlightIndex === index}
                          className="suggestion paper-data-table-row"
                          id={`${listboxId}-${result.id}`}
                          key={result.id}
                          onClick={() => selectResult(result)}
                          onMouseEnter={() => setHighlightIndex(index)}
                          type="button"
                          role="option"
                        >
                          <span className="suggestion-avatar-cell">
                            <CharacterAvatar
                              avatarUrl={result.avatarUrl}
                              className="suggestion-avatar"
                              initials={result.name.slice(0, 2)}
                              name={result.name}
                            />
                          </span>
                          <span className="suggestion-main">
                            <strong>{result.name}</strong>
                            <small>{result.firstAppearance.workTitle}</small>
                          </span>
                          <span className="suggestion-meta">选择</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="suggestion-state" role="status">
                      <Search size={17} aria-hidden="true" />
                      <span>没有找到匹配角色</span>
                    </div>
                  )}
                </Paper>
              ) : null}
            </div>
            <PaperSegmentSeparator />
            <PaperButton
              ariaLabel="提交猜测"
              className="single-game-submit multiplayer-guess-submit"
              disabled={submitDisabled}
              filled={!submitDisabled}
              onClick={submitSelected}
              tone="theme"
            >
              <Send size={18} aria-hidden="true" />
              <span>提交猜测</span>
            </PaperButton>
          </PaperSegmentGroup>
        </form>
      </div>
      {statusMessage ? (
        <Paper
          animateOnMount={false}
          as="div"
          className="multiplayer-guess-message"
          folded={false}
          pattern={false}
          role="status"
          sticker={false}
          tone={statusTone}
          unfoldOnHover={false}
          variant="tinted"
        >
          {statusMessage}
        </Paper>
      ) : null}
    </section>
  );
}
