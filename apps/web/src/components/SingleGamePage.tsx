"use client";

import {
  Check,
  ChevronsDown,
  ChevronsUp,
  Flag,
  Loader2,
  Minus,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  GAME_CONTENT_DEFINITIONS,
  HAIR_COLOR_LABELS,
} from "@touhouflandre/shared";
import type {
  CharacterSearchResult,
  FieldFeedback,
  PublicGameSession,
  SinglePlayerGameMode,
} from "@touhouflandre/shared";
import { CharacterAvatar } from "./CharacterAvatar";
import { modeConfig } from "../gameModes";
import { useCharacterSearch } from "../hooks/useCharacterSearch";
import { api } from "../lib/api";

const CHARACTER_GAME = GAME_CONTENT_DEFINITIONS.character;
const GAME_SEARCH_RESULT_LIMIT = 12;

type StoredSession = {
  id: string;
  puzzleKey?: string;
  guessCompletedElapsedSeconds?: number[];
};

const parseStoredSession = (value: string): StoredSession => {
  try {
    const parsed = JSON.parse(value) as StoredSession;
    if (parsed && typeof parsed.id === "string") return parsed;
  } catch {
    // Legacy storage contained only the session id.
  }
  return { id: value };
};

const feedbackClass = (feedback: FieldFeedback) =>
  `feedback feedback-${feedback.status}`;
const formatFeedbackValue = (feedback: FieldFeedback) =>
  feedback.displayValue.join("、");

const formatDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
};

const elapsedSecondsForSession = (
  session: PublicGameSession | null,
  nowMs: number,
) => {
  if (!session) return 0;
  const startedAt = Date.parse(session.startedAt);
  if (Number.isNaN(startedAt)) return 0;
  const endedAt =
    session.endedAt && !Number.isNaN(Date.parse(session.endedAt))
      ? Date.parse(session.endedAt)
      : nowMs;
  return Math.max(0, Math.floor((endedAt - startedAt) / 1000));
};

const normalizeGuessTimings = (
  timings: unknown,
  expectedLength: number,
): number[] => {
  if (!Array.isArray(timings)) return [];
  return timings
    .filter((entry): entry is number => Number.isFinite(entry) && entry >= 0)
    .slice(0, expectedLength);
};

const formatGuessDuration = (timings: number[], index: number) => {
  const completedAt = timings[index];
  const previousCompletedAt = index > 0 ? timings[index - 1] : 0;
  if (!Number.isFinite(completedAt)) return "--:--";
  if (index > 0 && !Number.isFinite(previousCompletedAt)) return "--:--";
  return formatDuration(completedAt - previousCompletedAt);
};

function FeedbackIcon({ feedback }: { feedback: FieldFeedback }) {
  if (feedback.status === "exact")
    return <Check size={14} aria-label="完全匹配" />;
  if (feedback.status === "partial")
    return <Minus size={14} aria-label="部分匹配" />;
  if (feedback.status === "higher")
    return <ChevronsUp size={14} aria-label="答案更晚" />;
  if (feedback.status === "lower")
    return <ChevronsDown size={14} aria-label="答案更早" />;
  return <X size={14} aria-label="不匹配" />;
}

function SuggestionPopover({
  anchor,
  children,
  id,
  open,
}: {
  anchor: React.RefObject<HTMLLabelElement | null>;
  children: React.ReactNode;
  id: string;
  open: boolean;
}) {
  const [position, setPosition] = useState<{
    bottom?: number;
    left: number;
    maxHeight: number;
    top?: number;
    width: number;
  } | null>(null);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    const updatePosition = () => {
      const element = anchor.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const margin = 12;
      const gap = 7;
      const width = Math.min(rect.width, window.innerWidth - margin * 2);
      const left = Math.min(
        Math.max(margin, rect.left),
        window.innerWidth - width - margin,
      );
      const spaceBelow = window.innerHeight - rect.bottom - gap - margin;
      const spaceAbove = rect.top - gap - margin;
      const placeBelow = spaceBelow >= 220 || spaceBelow >= spaceAbove;
      const availableSpace = placeBelow ? spaceBelow : spaceAbove;

      setPosition({
        bottom: placeBelow ? undefined : window.innerHeight - rect.top + gap,
        left,
        maxHeight: Math.max(80, Math.min(320, availableSpace)),
        top: placeBelow ? rect.bottom + gap : undefined,
        width,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchor, open]);

  if (!open || !position) return null;
  return createPortal(
    <div
      className="suggestion-list"
      id={id}
      role="listbox"
      aria-label="搜索建议"
      style={position}
    >
      {children}
    </div>,
    document.body,
  );
}

export function SingleGamePage({ mode }: { mode: SinglePlayerGameMode }) {
  const listboxId = useId();
  const searchBoxRef = useRef<HTMLLabelElement>(null);
  const loadRequestIdRef = useRef(0);
  const [session, setSession] = useState<PublicGameSession | null>(null);
  const [puzzleLabel, setPuzzleLabel] = useState(modeConfig[mode].puzzleLabel);
  const [query, setQuery] = useState("");
  const {
    error: searchError,
    loading: searchLoading,
    results,
    retry: retrySearch,
  } = useCharacterSearch(query, {
    enabled: Boolean(session),
    limit: GAME_SEARCH_RESULT_LIMIT,
    sessionId: session?.id,
    version: session?.catalogVersion ?? undefined,
  });
  const [selectedId, setSelectedId] = useState("");
  const [activeSuggestionId, setActiveSuggestionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [endingSession, setEndingSession] = useState(false);
  const [message, setMessage] = useState("");
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [guessCompletedElapsedSeconds, setGuessCompletedElapsedSeconds] =
    useState<number[]>([]);

  const guessedIds = useMemo(
    () => new Set(session?.guesses.map((guess) => guess.guessId) ?? []),
    [session],
  );
  const isFinished = session?.status === "won" || session?.status === "lost";
  const currentElapsedSeconds = useMemo(
    () => elapsedSecondsForSession(session, nowMs),
    [nowMs, session],
  );
  const selectableResults = useMemo(
    () => results.filter((result) => !guessedIds.has(result.id)),
    [guessedIds, results],
  );
  const showSuggestions =
    !suggestionsDismissed &&
    query.trim().length > 0 &&
    !isFinished &&
    !loading &&
    !submitting &&
    !endingSession;

  const persistSession = (
    nextMode: SinglePlayerGameMode,
    nextSession: PublicGameSession,
    nextGuessCompletedElapsedSeconds: number[] = guessCompletedElapsedSeconds,
  ) => {
    localStorage.setItem(
      modeConfig[nextMode].storageKey,
      JSON.stringify({
        id: nextSession.id,
        puzzleKey: nextSession.puzzleKey,
        guessCompletedElapsedSeconds: nextGuessCompletedElapsedSeconds,
      } satisfies StoredSession),
    );
  };

  const loadSession = async (nextMode: SinglePlayerGameMode) => {
    const requestId = ++loadRequestIdRef.current;
    const isCurrentRequest = () => loadRequestIdRef.current === requestId;

    setLoading(true);
    setSession(null);
    setPuzzleLabel(modeConfig[nextMode].puzzleLabel);
    setMessage("");
    setQuery("");
    setSelectedId("");
    setActiveSuggestionId("");
    setSuggestionsDismissed(false);
    setEndingSession(false);
    setGuessCompletedElapsedSeconds([]);
    setNowMs(Date.now());

    try {
      let dailyDateKey: string | undefined;
      if (nextMode === "daily") {
        dailyDateKey = (await api.catalog()).dailyDateKey;
        if (!isCurrentRequest()) return;
      }
      const storedValue = localStorage.getItem(modeConfig[nextMode].storageKey);
      if (storedValue) {
        try {
          const storedSession = parseStoredSession(storedValue);
          const restored = await api.getSession(storedSession.id);
          if (!isCurrentRequest()) return;
          if (nextMode === "daily" && restored.puzzleKey !== dailyDateKey) {
            localStorage.removeItem(modeConfig[nextMode].storageKey);
          } else {
            setSession(restored);
            setGuessCompletedElapsedSeconds(
              normalizeGuessTimings(
                storedSession.guessCompletedElapsedSeconds,
                restored.guesses.length,
              ),
            );
            setPuzzleLabel(
              nextMode === "daily"
                ? `${modeConfig[nextMode].label} ${restored.puzzleKey}`
                : modeConfig[nextMode].puzzleLabel,
            );
            return;
          }
        } catch (error) {
          if (
            typeof error !== "object" ||
            error === null ||
            !("status" in error) ||
            error.status !== 404
          ) {
            throw error;
          }
          localStorage.removeItem(modeConfig[nextMode].storageKey);
        }
      }

      const created = await api.createPuzzle(nextMode);
      if (!isCurrentRequest()) return;
      setSession(created.session);
      setGuessCompletedElapsedSeconds([]);
      setPuzzleLabel(created.puzzleLabel);
      persistSession(nextMode, created.session, []);
    } catch (error) {
      if (!isCurrentRequest()) return;
      setMessage(error instanceof Error ? error.message : "加载游戏失败。");
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  };

  const startFresh = async (nextMode = mode) => {
    localStorage.removeItem(modeConfig[nextMode].storageKey);
    await loadSession(nextMode);
  };

  useEffect(() => {
    if (!session || isFinished) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isFinished, session]);

  const requestFreshSession = async () => {
    if (mode !== "random" || loading || submitting || endingSession) return;
    if (
      session?.status === "playing" &&
      session.guesses.length > 0 &&
      !window.confirm("当前随机题进度将会丢失，确定重新开始吗？")
    ) {
      return;
    }
    await startFresh("random");
  };

  useEffect(() => {
    void loadSession(mode);
    return () => {
      loadRequestIdRef.current += 1;
    };
  }, [mode]);

  const submitGuess = async (guessId = selectedId) => {
    if (!session || !guessId || submitting || isFinished) return;
    setSubmitting(true);
    setMessage("");

    try {
      const payload = await api.submitGuess(session.id, guessId);
      const completedElapsedSeconds = elapsedSecondsForSession(
        payload,
        Date.now(),
      );
      const nextGuessCompletedElapsedSeconds = [
        ...guessCompletedElapsedSeconds,
        completedElapsedSeconds,
      ].slice(0, payload.guesses.length);
      setSession(payload);
      setGuessCompletedElapsedSeconds(nextGuessCompletedElapsedSeconds);
      persistSession(mode, payload, nextGuessCompletedElapsedSeconds);
      setQuery("");
      setSelectedId("");
      setActiveSuggestionId("");
      setSuggestionsDismissed(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "提交失败。");
    } finally {
      setSubmitting(false);
    }
  };

  const forfeitSession = async () => {
    if (!session || loading || submitting || endingSession || isFinished)
      return;
    setEndingSession(true);
    setMessage("");

    try {
      const payload = await api.forfeitSession(session.id);
      const completedElapsedSeconds = elapsedSecondsForSession(
        payload,
        Date.now(),
      );
      const nextGuessCompletedElapsedSeconds = [
        ...guessCompletedElapsedSeconds,
        completedElapsedSeconds,
      ].slice(0, payload.guesses.length);
      setSession(payload);
      setGuessCompletedElapsedSeconds(nextGuessCompletedElapsedSeconds);
      persistSession(mode, payload, nextGuessCompletedElapsedSeconds);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "放弃失败。");
    } finally {
      setEndingSession(false);
    }
  };

  const selectSuggestion = useCallback((result: CharacterSearchResult) => {
    setSelectedId(result.id);
    setQuery(result.name);
    setActiveSuggestionId("");
    setSuggestionsDismissed(true);
  }, []);

  const moveActiveSuggestion = (step: 1 | -1) => {
    if (!selectableResults.length) return;
    const currentIndex = selectableResults.findIndex(
      (result) => result.id === activeSuggestionId,
    );
    const nextIndex =
      currentIndex < 0
        ? step === 1
          ? 0
          : selectableResults.length - 1
        : (currentIndex + step + selectableResults.length) %
          selectableResults.length;
    setActiveSuggestionId(selectableResults[nextIndex].id);
  };

  useEffect(() => {
    if (
      activeSuggestionId &&
      !selectableResults.some((result) => result.id === activeSuggestionId)
    ) {
      setActiveSuggestionId("");
    }
  }, [activeSuggestionId, selectableResults]);

  useEffect(() => {
    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        searchBoxRef.current?.contains(target) ||
        target.closest(".suggestion-list")
      ) {
        return;
      }
      setSuggestionsDismissed(true);
      setActiveSuggestionId("");
    };

    document.addEventListener("pointerdown", handleOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", handleOutsidePointer);
  }, []);

  return (
    <>
      <section className="game-surface" aria-label="TouhouFlandre 游戏区域">
        <div className="status-strip">
          <div className="puzzle-status">
            <span className="label">题目</span>
            <strong>{puzzleLabel}</strong>
            <span className="progress-track" aria-hidden="true">
              <span
                style={{
                  width: `${((session?.guesses.length ?? 0) / (session?.maxGuesses ?? CHARACTER_GAME.maxGuesses)) * 100}%`,
                }}
              />
            </span>
          </div>
          <div>
            <span className="label">计时</span>
            <strong>{formatDuration(currentElapsedSeconds)}</strong>
          </div>
          <div>
            <span className="label">进度</span>
            <strong>
              {session?.guesses.length ?? 0}/
              {session?.maxGuesses ?? CHARACTER_GAME.maxGuesses}
            </strong>
          </div>
          <div>
            <span className="label">状态</span>
            <strong className={`session-state ${session?.status ?? "playing"}`}>
              {session?.status === "won"
                ? "已猜中"
                : session?.status === "lost"
                  ? "未猜中"
                  : "进行中"}
            </strong>
          </div>
          <div className="status-actions">
            {mode === "random" ? (
              <button
                className="icon-button"
                type="button"
                onClick={() => void requestFreshSession()}
                title="重新开始"
                aria-label="重新开始随机题"
                disabled={loading || submitting || endingSession}
              >
                <RotateCcw size={18} aria-hidden="true" />
              </button>
            ) : null}
            <button
              className="icon-button"
              type="button"
              onClick={() => void forfeitSession()}
              title="放弃本局"
              aria-label="放弃本局"
              disabled={
                loading || submitting || endingSession || !session || isFinished
              }
            >
              <Flag size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

        <form
          className="guess-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submitGuess();
          }}
        >
          <div className="search-combobox">
            <label className="search-box" ref={searchBoxRef}>
              <Search size={18} aria-hidden="true" />
              <input
                value={query}
                onFocus={() => setSuggestionsDismissed(false)}
                onBlur={() => setActiveSuggestionId("")}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedId("");
                  setActiveSuggestionId("");
                  setSuggestionsDismissed(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    setSuggestionsDismissed(false);
                    moveActiveSuggestion(event.key === "ArrowDown" ? 1 : -1);
                    return;
                  }
                  if (event.key === "Escape" && showSuggestions) {
                    event.preventDefault();
                    setSuggestionsDismissed(true);
                    setActiveSuggestionId("");
                    return;
                  }
                  if (event.key === "Enter" && showSuggestions) {
                    const activeResult = selectableResults.find(
                      (result) => result.id === activeSuggestionId,
                    );
                    if (activeResult) {
                      event.preventDefault();
                      selectSuggestion(activeResult);
                    }
                  }
                }}
                disabled={
                  loading ||
                  submitting ||
                  endingSession ||
                  !session ||
                  isFinished
                }
                placeholder="输入角色名、别名或初登场作品"
                aria-label="搜索东方角色"
                aria-autocomplete="list"
                aria-controls={listboxId}
                aria-activedescendant={
                  showSuggestions && activeSuggestionId
                    ? `${listboxId}-${activeSuggestionId}`
                    : undefined
                }
                aria-expanded={showSuggestions}
              />
            </label>
            <SuggestionPopover
              anchor={searchBoxRef}
              id={listboxId}
              open={showSuggestions}
            >
              {searchLoading ? (
                <div className="suggestion-state" role="status">
                  <Loader2 className="spin" size={17} aria-hidden="true" />
                  <span>正在搜索</span>
                </div>
              ) : searchError ? (
                <div className="suggestion-state suggestion-error" role="alert">
                  <span>{searchError}</span>
                  <button
                    type="button"
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={retrySearch}
                  >
                    重试
                  </button>
                </div>
              ) : results.length ? (
                results.map((result) => {
                  const disabled = guessedIds.has(result.id);
                  const active = activeSuggestionId === result.id;
                  return (
                    <button
                      className={active ? "suggestion selected" : "suggestion"}
                      id={`${listboxId}-${result.id}`}
                      key={result.id}
                      type="button"
                      tabIndex={-1}
                      disabled={disabled}
                      role="option"
                      aria-selected={active}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        selectSuggestion(result);
                      }}
                    >
                      <CharacterAvatar
                        avatarUrl={result.avatarUrl}
                        name={result.name}
                        initials={result.initials}
                        className="suggestion-avatar"
                      />
                      <span className="suggestion-main">
                        <strong>{result.name}</strong>
                        <small>{result.subtitle}</small>
                      </span>
                      <span className="suggestion-meta">
                        {disabled
                          ? "已猜"
                          : result.hairColors
                              .map((color) => HAIR_COLOR_LABELS[color])
                              .join("、")}
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="suggestion-state" role="status">
                  <Search size={17} aria-hidden="true" />
                  <span>没有找到匹配角色</span>
                </div>
              )}
            </SuggestionPopover>
          </div>
          <button
            className="primary-button"
            type="submit"
            disabled={
              !selectedId ||
              loading ||
              submitting ||
              endingSession ||
              isFinished
            }
          >
            {submitting ? (
              <Loader2 className="spin" size={18} aria-hidden="true" />
            ) : (
              <Search size={18} aria-hidden="true" />
            )}
            <span>提交猜测</span>
          </button>
        </form>

        {message ? <p className="message error">{message}</p> : null}

        <div className="table-wrap">
          <table className="guess-table">
            <thead>
              <tr>
                <th>角色</th>
                {CHARACTER_GAME.fields.map((field) => (
                  <th key={field.key}>{field.label}</th>
                ))}
                <th>本次猜测用时</th>
              </tr>
            </thead>
            <tbody>
              {session?.guesses.length ? (
                session.guesses.map((guess, index) => (
                  <tr
                    key={guess.guessId}
                    style={{ animationDelay: `${Math.min(index, 7) * 45}ms` }}
                  >
                    <th scope="row">
                      <span className="guess-character">
                        <CharacterAvatar
                          avatarUrl={guess.guessAvatarUrl}
                          name={guess.guessName}
                          initials={guess.guessName.slice(0, 2)}
                          className="guess-avatar"
                        />
                        <span>{guess.guessName}</span>
                      </span>
                    </th>
                    {guess.feedback.map((feedback) => (
                      <td key={feedback.field}>
                        <span
                          className={feedbackClass(feedback)}
                          title={`${feedback.label}: ${feedback.status}`}
                        >
                          <b>
                            <FeedbackIcon feedback={feedback} />
                          </b>
                          <span>{formatFeedbackValue(feedback)}</span>
                        </span>
                      </td>
                    ))}
                    <td>
                      <span className="guess-duration">
                        {formatGuessDuration(
                          guessCompletedElapsedSeconds,
                          index,
                        )}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    className="empty-state"
                    colSpan={CHARACTER_GAME.fields.length + 2}
                  >
                    {loading ? (
                      <span>
                        <Loader2
                          className="spin"
                          size={20}
                          aria-hidden="true"
                        />{" "}
                        正在连接本地题库
                      </span>
                    ) : !session && message ? (
                      <span>
                        <X size={20} aria-hidden="true" /> 本局加载失败
                      </span>
                    ) : (
                      <span>
                        <Search size={20} aria-hidden="true" /> 等待第一次猜测
                      </span>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {session && isFinished ? (
        <aside className="result-panel" aria-label="游戏结果">
          <div>
            <p className="kicker">
              {session.status === "won" ? "Clear" : "Failed"}
            </p>
            <h2>{session.status === "won" ? "猜中了" : "本次游戏结束"}</h2>
            <p>
              答案是 <strong>{session.answer?.names.zhHans}</strong>，共使用{" "}
              {session.guesses.length} 次猜测。
            </p>
          </div>
          {session.answer ? (
            <CharacterAvatar
              avatarUrl={session.answer.avatarUrl}
              name={session.answer.names.zhHans}
              initials={session.answer.names.zhHans.slice(0, 2)}
              className="answer-token"
            />
          ) : null}
          {mode === "random" ? (
            <div className="result-actions">
              <button
                className="primary-button"
                type="button"
                onClick={() => void requestFreshSession()}
                disabled={loading || submitting}
              >
                <RotateCcw size={18} aria-hidden="true" />
                <span>再来一局</span>
              </button>
            </div>
          ) : null}
        </aside>
      ) : null}
    </>
  );
}
