"use client";

// 与单人模式一致的“先选择、再提交”猜测组件；定位由多人猜测底栏负责。
import { Loader2, Search, Send } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { CharacterAvatar } from "./CharacterAvatar";
import { FeedbackLegend } from "./FeedbackLegend";
import { SuggestionPopover } from "./SuggestionPopover";
import {
  useCharacterSearch,
  type MultiplayerCharacterSearchContext,
} from "../../hooks/useCharacterSearch";
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
  searchContext,
  preserveDraftWhenDisabled = false,
  statusTone = "warning",
  guessedIds,
  statusMessage,
}: {
  onGuess: (guessId: string) => Promise<boolean>;
  disabled?: boolean;
  searchContext?: MultiplayerCharacterSearchContext;
  guessedIds: ReadonlySet<string>;
  preserveDraftWhenDisabled?: boolean;
  statusTone?: "success" | "warning" | "danger" | "neutral";
  statusMessage?: string | null;
}) {
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [restoreFocusRequested, setRestoreFocusRequested] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchBoxRef = useRef<HTMLLabelElement>(null);
  const submittingRef = useRef(false);
  const { results, loading, error } = useCharacterSearch(query, {
    context: searchContext,
    enabled: Boolean(searchContext) && !disabled && !submitting,
    limit: GAME_SEARCH_RESULT_LIMIT,
  });
  const selectableResults = results.filter(
    (result) => !guessedIds.has(result.id),
  );
  const hasQuery = query.trim().length > 0;
  const showPopover = hasQuery && !selectedId && !disabled;
  const submitDisabled = Boolean(disabled || submitting || !selectedId);

  useEffect(() => {
    setHighlightIndex(0);
  }, [query, results]);

  useEffect(() => {
    if (!disabled || preserveDraftWhenDisabled) return;
    setQuery("");
    setSelectedId("");
  }, [disabled, preserveDraftWhenDisabled]);

  useEffect(() => {
    if (!restoreFocusRequested || disabled || submitting) return;
    const timeout = window.setTimeout(() => {
      inputRef.current?.focus();
      setRestoreFocusRequested(false);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [disabled, restoreFocusRequested, submitting]);

  const selectResult = (result: (typeof selectableResults)[number]) => {
    setSelectedId(result.id);
    setHighlightIndex(0);
  };

  const submitGuess = async (guessId: string, restoreFocus = false) => {
    if (disabled || submittingRef.current || !guessId) return;
    submittingRef.current = true;
    setSubmitting(true);
    if (restoreFocus) setRestoreFocusRequested(true);
    try {
      if (await onGuess(guessId)) {
        setQuery("");
        setSelectedId("");
        setHighlightIndex(0);
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const submitSelected = (restoreFocus = false) =>
    submitGuess(selectedId, restoreFocus);

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
      if (result) {
        selectResult(result);
        void submitGuess(result.id, true);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setQuery("");
      setSelectedId("");
    }
  };

  return (
    <section
      aria-label="多人猜测区域"
      className="multiplayer-guess-bar"
      data-guess-input-bar
    >
      <FeedbackLegend className="single-game-feedback-legend" />
      <div className="single-game-input-group">
        <form
          aria-label="猜测"
          className="guess-form"
          onSubmit={(event) => {
            const restoreFocus = document.activeElement === inputRef.current;
            event.preventDefault();
            void submitSelected(restoreFocus);
          }}
        >
          <PaperSegmentGroup
            className="single-game-guess-group"
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
                containerRef={searchBoxRef}
                disabled={disabled}
                inputRef={inputRef}
                folded={false}
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
              <SuggestionPopover
                anchor={searchBoxRef}
                id={listboxId}
                open={showPopover}
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
                  <>
                    {selectableResults.map((result, index) => (
                      <button
                        aria-selected={highlightIndex === index}
                        className="suggestion paper-data-table-row"
                        id={`${listboxId}-${result.id}`}
                        key={result.id}
                        onClick={() => {
                          selectResult(result);
                          void submitGuess(result.id);
                        }}
                        onMouseEnter={() => setHighlightIndex(index)}
                        onPointerDown={(event) => event.preventDefault()}
                        role="option"
                        tabIndex={-1}
                        type="button"
                      >
                        <span className="suggestion-avatar-cell">
                          <CharacterAvatar
                            avatarUrl={result.avatarUrl}
                            className="suggestion-avatar"
                            initials={result.initials}
                            name={result.name}
                          />
                        </span>
                        <span className="suggestion-main">
                          <strong>{result.name}</strong>
                          <small>{result.subtitle}</small>
                        </span>
                        <span className="suggestion-meta">选择</span>
                      </button>
                    ))}
                    <div
                      aria-hidden="true"
                      className="suggestion-columns paper-data-table-header paper-data-table-row"
                    >
                      <span>头像</span>
                      <span>角色</span>
                      <span>选择</span>
                    </div>
                  </>
                ) : (
                  <div className="suggestion-state" role="status">
                    <Search size={17} aria-hidden="true" />
                    <span>没有找到匹配角色</span>
                  </div>
                )}
              </SuggestionPopover>
            </div>
            <PaperSegmentSeparator />
            <PaperButton
              ariaLabel="提交猜测"
              className="single-game-submit"
              disabled={submitDisabled}
              filled={!submitDisabled}
              onClick={() => void submitSelected()}
              tone="theme"
            >
              <Send size={18} aria-hidden="true" />
              <span>提交猜测</span>
            </PaperButton>
          </PaperSegmentGroup>
        </form>
        {statusMessage ? (
          <Paper
            animateOnMount={false}
            as="div"
            className="single-game-message multiplayer-guess-message"
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
      </div>
    </section>
  );
}
