"use client";

import {
  Check,
  Copy,
  Flag,
  Loader2,
  Play,
  RotateCcw,
  Search,
  Send,
  X,
} from "lucide-react";
import { message as globalMessage } from "antd";
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
  createShareText,
  GAME_CONTENT_DEFINITIONS,
  HAIR_COLOR_LABELS,
  QUESTION_DIFFICULTY_LABELS,
  QUESTION_DIFFICULTY_PRESETS,
  isUnlimitedGuessLimit,
  visibleQuestionFields,
} from "@touhouflandre/shared";
import type {
  CharacterSearchResult,
  FieldFeedback,
  QuestionDifficultyPreset,
  PublicGameSession,
  SinglePlayerGameMode,
} from "@touhouflandre/shared";
import { CharacterAvatar } from "./CharacterAvatar";
import { FeedbackLegendButton } from "./FeedbackLegendButton";
import { FeedbackStatusIcon } from "./FeedbackStatusIcon";
import { modeConfig } from "../gameModes";
import { useCharacterSearch } from "../hooks/useCharacterSearch";
import { api } from "../lib/api";
import { useForegroundTimer, useWallClockTimer } from "../stats/timer";
import {
  deleteSingleStatsDraft,
  loadSingleStatsDraft,
  recordSingleSession,
  saveSingleStatsDraft,
} from "../stats/singleRecorder";
import {
  catalogFullToSnapshot,
  loadLocalQuestionScope,
} from "../lib/questionScopeStorage";

const CHARACTER_GAME = GAME_CONTENT_DEFINITIONS.character;
const GAME_SEARCH_RESULT_LIMIT = 12;
const DEFAULT_DAILY_DIFFICULTY: QuestionDifficultyPreset = "normal";
const DAILY_DIFFICULTIES = QUESTION_DIFFICULTY_PRESETS;

const writeStatsInBackground = (operation: Promise<unknown>) => {
  void operation.catch((error) => console.error("本地单人统计写入失败", error));
};

type StoredSession = {
  id: string;
  puzzleKey?: string;
  activeElapsedMs?: number;
  guessCompletedElapsedMs?: number[];
  savedAtMs?: number;
  /** 兼容旧版墙钟计时字段。 */
  guessCompletedElapsedSeconds?: number[];
};

type DailySessionStatus = "won" | "lost" | "playing" | null;

const dailyStorageKey = (difficulty: QuestionDifficultyPreset) =>
  difficulty === DEFAULT_DAILY_DIFFICULTY
    ? modeConfig.daily.storageKey
    : `${modeConfig.daily.storageKey}:${difficulty}`;

const storageKeyForMode = (
  mode: SinglePlayerGameMode,
  difficulty: QuestionDifficultyPreset,
) => (mode === "daily" ? dailyStorageKey(difficulty) : modeConfig[mode].storageKey);

const emptyDailyStatuses = (): Record<QuestionDifficultyPreset, DailySessionStatus> => ({
  easy: null,
  normal: null,
  hard: null,
  lunatic: null,
});

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

const dailyPuzzleLabel = (
  dateKey: string | undefined,
  difficulty: QuestionDifficultyPreset,
) =>
  dateKey
    ? `每日题 ${dateKey} - ${QUESTION_DIFFICULTY_LABELS[difficulty]} Level`
    : modeConfig.daily.puzzleLabel;

const normalizeGuessTimings = (
  timings: unknown,
  expectedLength: number,
): number[] => {
  if (!Array.isArray(timings)) return [];
  return timings
    .filter((entry): entry is number => Number.isFinite(entry) && entry >= 0)
    .slice(0, expectedLength);
};

const validTimestamp = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;

const formatGuessDuration = (timings: number[], index: number) => {
  const completedAt = timings[index];
  const previousCompletedAt = index > 0 ? timings[index - 1] : 0;
  if (!Number.isFinite(completedAt)) return "--:--";
  if (index > 0 && !Number.isFinite(previousCompletedAt)) return "--:--";
  return formatDuration((completedAt - previousCompletedAt) / 1000);
};

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

function DailyDifficultyButtons({
  active,
  disabled,
  onSelect,
  statuses,
}: {
  active: QuestionDifficultyPreset;
  disabled: boolean;
  onSelect: (difficulty: QuestionDifficultyPreset) => void;
  statuses: Record<QuestionDifficultyPreset, DailySessionStatus>;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="每日题难度">
      {DAILY_DIFFICULTIES.map((difficulty) => {
        const status = statuses[difficulty];
        const completedClass =
          status === "won"
            ? "border-[var(--jade-border)] bg-jade-soft text-jade"
            : status === "lost"
              ? "border-vermilion bg-vermilion-soft text-vermilion"
              : active === difficulty
                ? "border-vermilion bg-vermilion text-[var(--accent-contrast)]"
                : "border-line bg-paper-muted text-ink-soft";
        return (
          <button
            key={difficulty}
            type="button"
            disabled={disabled && active !== difficulty}
            aria-pressed={active === difficulty}
            className={`inline-flex min-h-7 items-center gap-1 rounded-[4px] border px-2 text-[0.7rem] font-black ${completedClass} disabled:opacity-60`}
            onClick={() => onSelect(difficulty)}
          >
            <span>{QUESTION_DIFFICULTY_LABELS[difficulty]}</span>
            {status === "won" ? (
              <Check size={13} aria-hidden="true" />
            ) : status === "lost" ? (
              <X size={13} aria-hidden="true" />
            ) : (
              <Play size={12} aria-hidden="true" />
            )}
          </button>
        );
      })}
    </div>
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
  const [timingOut, setTimingOut] = useState(false);
  const [message, setMessage] = useState("");
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const [initialElapsedMs, setInitialElapsedMs] = useState(0);
  const [guessCompletedElapsedMs, setGuessCompletedElapsedMs] =
    useState<number[]>([]);
  const [dailyDifficulty, setDailyDifficulty] =
    useState<QuestionDifficultyPreset>(DEFAULT_DAILY_DIFFICULTY);
  const [dailyStatuses, setDailyStatuses] =
    useState<Record<QuestionDifficultyPreset, DailySessionStatus>>(
      emptyDailyStatuses,
    );

  const guessedIds = useMemo(
    () => new Set(session?.guesses.map((guess) => guess.guessId) ?? []),
    [session],
  );
  const isFinished = session?.status === "won" || session?.status === "lost";
  const hasGuessRecords = (session?.guesses.length ?? 0) > 0;
  const useWallClockElapsed = mode === "daily" && hasGuessRecords;
  const foregroundTimer = useForegroundTimer(
    session?.id ?? "none",
    Boolean(session && !isFinished && !useWallClockElapsed),
    initialElapsedMs,
  );
  const wallClockTimer = useWallClockTimer(
    session?.id ?? "none",
    Boolean(session && !isFinished && useWallClockElapsed),
    initialElapsedMs,
  );
  const activeTimer = useWallClockElapsed ? wallClockTimer : foregroundTimer;
  const elapsedMs = activeTimer.elapsedMs;
  const checkpoint = activeTimer.checkpoint;
  const currentElapsedSeconds = Math.floor(elapsedMs / 1000);
  const turnLimit = session?.questionScope?.rules.turnLimit;
  const turnLimitEnabled = Boolean(turnLimit?.enabled && turnLimit.seconds > 0);
  const turnLimitSeconds = turnLimit?.seconds ?? 0;
  const turnStartElapsedMs = guessCompletedElapsedMs.at(-1) ?? 0;
  const currentTurnElapsedMs = session && !isFinished
    ? Math.max(0, elapsedMs - turnStartElapsedMs)
    : 0;
  const turnRemainingSeconds = turnLimitEnabled
    ? Math.max(0, turnLimitSeconds - Math.floor(currentTurnElapsedMs / 1000))
    : null;
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
    !endingSession &&
    !timingOut;
  const visibleFields = useMemo(
    () =>
      visibleQuestionFields(
        session?.questionScope?.rules,
        CHARACTER_GAME.fields,
      ),
    [session?.questionScope?.rules],
  );
  const maxGuesses = session?.maxGuesses ?? CHARACTER_GAME.maxGuesses;
  const hasUnlimitedGuesses = isUnlimitedGuessLimit(maxGuesses);
  const guessProgressPercent = Math.min(
    100,
    ((session?.guesses.length ?? 0) / maxGuesses) * 100,
  );

  const persistSession = (
    nextMode: SinglePlayerGameMode,
    nextSession: PublicGameSession,
    nextGuessCompletedElapsedMs: number[] = guessCompletedElapsedMs,
    nextActiveElapsedMs = elapsedMs,
    difficulty = dailyDifficulty,
  ) => {
    const shouldPersistTiming =
      nextMode !== "daily" ||
      nextSession.guesses.length > 0 ||
      nextSession.status !== "playing";
    const stored: StoredSession = {
      id: nextSession.id,
      puzzleKey: nextSession.puzzleKey,
    };
    if (shouldPersistTiming) {
      stored.activeElapsedMs = nextActiveElapsedMs;
      stored.guessCompletedElapsedMs = nextGuessCompletedElapsedMs;
      stored.savedAtMs = Date.now();
    }
    localStorage.setItem(
      storageKeyForMode(nextMode, difficulty),
      JSON.stringify(stored),
    );
  };

  const setDailyStatus = (
    difficulty: QuestionDifficultyPreset,
    status: DailySessionStatus,
  ) => {
    setDailyStatuses((current) => ({ ...current, [difficulty]: status }));
  };

  const refreshDailyStatuses = async (dateKey: string) => {
    const entries = await Promise.all(
      DAILY_DIFFICULTIES.map(async (difficulty) => {
        const storedValue = localStorage.getItem(dailyStorageKey(difficulty));
        if (!storedValue) return [difficulty, null] as const;
        try {
          const storedSession = parseStoredSession(storedValue);
          const restored = await api.getSession(storedSession.id);
          if (restored.puzzleKey !== dateKey) return [difficulty, null] as const;
          return [difficulty, restored.status] as const;
        } catch {
          return [difficulty, null] as const;
        }
      }),
    );
    setDailyStatuses(
      entries.reduce((acc, [difficulty, status]) => {
        acc[difficulty] = status;
        return acc;
      }, emptyDailyStatuses()),
    );
  };

  const loadSession = async (
    nextMode: SinglePlayerGameMode,
    difficulty: QuestionDifficultyPreset = dailyDifficulty,
  ) => {
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
    setTimingOut(false);
    setGuessCompletedElapsedMs([]);
    setInitialElapsedMs(0);
    if (nextMode === "daily") setDailyDifficulty(difficulty);

    try {
      let dailyDateKey: string | undefined;
      if (nextMode === "daily") {
        dailyDateKey = (await api.catalog()).dailyDateKey;
        if (!isCurrentRequest()) return;
        void refreshDailyStatuses(dailyDateKey);
      }
      const storedValue = localStorage.getItem(storageKeyForMode(nextMode, difficulty));
      if (storedValue) {
        try {
          const storedSession = parseStoredSession(storedValue);
          const restored = await api.getSession(storedSession.id);
          if (!isCurrentRequest()) return;
          const restoredDifficulty = restored.questionScope?.difficulty;
          const mismatchedSession =
            restored.mode !== nextMode ||
            (nextMode === "daily" &&
              (restored.puzzleKey !== dailyDateKey ||
                restoredDifficulty !== difficulty));
          if (mismatchedSession) {
            const oldTimings = normalizeGuessTimings(
              storedSession.guessCompletedElapsedMs ??
                storedSession.guessCompletedElapsedSeconds?.map((value) => value * 1000),
              restored.guesses.length,
            );
            const oldElapsed = Math.max(0, storedSession.activeElapsedMs ?? oldTimings.at(-1) ?? 0);
            if (restored.status !== "playing") {
              writeStatsInBackground(recordSingleSession(restored, nextMode, oldElapsed, oldTimings));
            } else {
              writeStatsInBackground(deleteSingleStatsDraft(restored.id));
            }
            localStorage.removeItem(storageKeyForMode(nextMode, difficulty));
          } else {
            const localTimings = normalizeGuessTimings(
              storedSession.guessCompletedElapsedMs ??
                storedSession.guessCompletedElapsedSeconds?.map((value) => value * 1000),
              restored.guesses.length,
            );
            const draft = await loadSingleStatsDraft(restored.id);
            const restoredTimings = localTimings.length
              ? localTimings
              : normalizeGuessTimings(draft?.guessCompletedElapsedMs, restored.guesses.length);
            const baseElapsed = Math.max(
              storedSession.activeElapsedMs ?? 0,
              draft?.activeElapsedMs ?? 0,
              restoredTimings.at(-1) ?? 0,
            );
            const savedAtMs =
              validTimestamp(storedSession.savedAtMs) ??
              validTimestamp(draft?.updatedAt ? Date.parse(draft.updatedAt) : undefined);
            const restoredElapsed =
              nextMode === "daily" &&
              restored.status === "playing" &&
              restored.guesses.length > 0 &&
              savedAtMs
                ? baseElapsed + Math.max(0, Date.now() - savedAtMs)
                : baseElapsed;
            setSession(restored);
            setGuessCompletedElapsedMs(restoredTimings);
            setInitialElapsedMs(restoredElapsed);
            setPuzzleLabel(
              nextMode === "daily"
                ? dailyPuzzleLabel(restored.puzzleKey, difficulty)
                : modeConfig[nextMode].puzzleLabel,
            );
            if (nextMode === "daily") setDailyStatus(difficulty, restored.status);
            if (restored.status !== "playing") {
              writeStatsInBackground(recordSingleSession(restored, nextMode, restoredElapsed, restoredTimings));
            } else {
              writeStatsInBackground(saveSingleStatsDraft(restored, nextMode, restoredElapsed, restoredTimings));
            }
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
          localStorage.removeItem(storageKeyForMode(nextMode, difficulty));
        }
      }

      const createBody =
        nextMode === "daily"
          ? { difficulty }
          : {
              questionScope: loadLocalQuestionScope(
                catalogFullToSnapshot(await api.catalogFull()),
              ).config,
            };
      const created = await api.createPuzzle(nextMode, createBody);
      if (!isCurrentRequest()) return;
      setSession(created.session);
      setGuessCompletedElapsedMs([]);
      setInitialElapsedMs(0);
      setPuzzleLabel(
        nextMode === "daily"
          ? dailyPuzzleLabel(created.session.puzzleKey ?? dailyDateKey, difficulty)
          : created.puzzleLabel,
      );
      persistSession(nextMode, created.session, [], 0, difficulty);
      if (nextMode === "daily") setDailyStatus(difficulty, created.session.status);
      writeStatsInBackground(saveSingleStatsDraft(created.session, nextMode, 0, []));
    } catch (error) {
      if (!isCurrentRequest()) return;
      setMessage(error instanceof Error ? error.message : "加载游戏失败。");
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  };

  const startFresh = async (
    nextMode = mode,
    difficulty = dailyDifficulty,
  ) => {
    localStorage.removeItem(storageKeyForMode(nextMode, difficulty));
    await loadSession(nextMode, difficulty);
  };

  const requestFreshSession = async () => {
    if (mode !== "random" || loading || submitting || endingSession || timingOut) return;
    if (
      session?.status === "playing" &&
      session.guesses.length > 0 &&
      !window.confirm("当前随机题进度将会丢失，确定重新开始吗？")
    ) {
      return;
    }
    if (session?.status === "playing" && session.guesses.length > 0) {
      const completedElapsedMs = checkpoint();
      const forfeited = await api.forfeitSession(session.id);
      writeStatsInBackground(recordSingleSession(
        forfeited,
        mode,
        completedElapsedMs,
        guessCompletedElapsedMs,
        "abandoned",
      ));
    }
    await startFresh("random");
  };

  const switchDailyDifficulty = async (difficulty: QuestionDifficultyPreset) => {
    if (mode !== "daily" || loading || submitting || endingSession || timingOut) return;
    if (session && !isFinished) {
      if (session.guesses.length === 0) {
        persistSession("daily", session, [], 0, dailyDifficulty);
      } else {
        const activeElapsedMs = checkpoint();
        persistSession("daily", session, guessCompletedElapsedMs, activeElapsedMs, dailyDifficulty);
        writeStatsInBackground(saveSingleStatsDraft(
          session,
          "daily",
          activeElapsedMs,
          guessCompletedElapsedMs,
        ));
      }
    }
    await loadSession("daily", difficulty);
  };

  useEffect(() => {
    void loadSession(mode, DEFAULT_DAILY_DIFFICULTY);
    return () => {
      loadRequestIdRef.current += 1;
    };
  }, [mode]);

  useEffect(() => {
    if (!session || isFinished) return;
    const flush = () => {
      if (mode === "daily" && session.status === "playing" && session.guesses.length === 0) {
        persistSession(mode, session, [], 0, dailyDifficulty);
        return;
      }
      const activeElapsedMs = checkpoint();
      persistSession(mode, session, guessCompletedElapsedMs, activeElapsedMs, dailyDifficulty);
      writeStatsInBackground(saveSingleStatsDraft(
        session,
        mode,
        activeElapsedMs,
        guessCompletedElapsedMs,
      ));
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [session, isFinished, mode, guessCompletedElapsedMs, checkpoint, dailyDifficulty]);

  const submitGuess = async (guessId = selectedId) => {
    if (!session || !guessId || submitting || timingOut || isFinished) return;
    setSubmitting(true);
    setMessage("");
    const completedElapsedMs = checkpoint();

    try {
      const payload = await api.submitGuess(
        session.id,
        guessId,
        turnLimitEnabled ? session.guesses.length : undefined,
      );
      const nextGuessCompletedElapsedMs = [
        ...guessCompletedElapsedMs,
        completedElapsedMs,
      ].slice(0, payload.guesses.length);
      setSession(payload);
      setGuessCompletedElapsedMs(nextGuessCompletedElapsedMs);
      setInitialElapsedMs(completedElapsedMs);
      persistSession(mode, payload, nextGuessCompletedElapsedMs, completedElapsedMs, dailyDifficulty);
      if (mode === "daily") setDailyStatus(dailyDifficulty, payload.status);
      if (payload.status === "playing") {
        writeStatsInBackground(saveSingleStatsDraft(payload, mode, completedElapsedMs, nextGuessCompletedElapsedMs));
      } else {
        writeStatsInBackground(recordSingleSession(payload, mode, completedElapsedMs, nextGuessCompletedElapsedMs));
      }
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

  const recordTimeout = useCallback(async () => {
    if (
      !session ||
      !turnLimitEnabled ||
      turnLimitSeconds <= 0 ||
      loading ||
      submitting ||
      endingSession ||
      timingOut ||
      isFinished
    ) {
      return;
    }
    setTimingOut(true);
    setMessage("");
    checkpoint();
    const completedElapsedMs =
      (guessCompletedElapsedMs.at(-1) ?? 0) + turnLimitSeconds * 1000;

    try {
      const payload = await api.timeoutSession(session.id, session.guesses.length);
      const nextGuessCompletedElapsedMs = [
        ...guessCompletedElapsedMs,
        completedElapsedMs,
      ].slice(0, payload.guesses.length);
      setSession(payload);
      setGuessCompletedElapsedMs(nextGuessCompletedElapsedMs);
      setInitialElapsedMs(completedElapsedMs);
      persistSession(mode, payload, nextGuessCompletedElapsedMs, completedElapsedMs, dailyDifficulty);
      if (mode === "daily") setDailyStatus(dailyDifficulty, payload.status);
      if (payload.status === "playing") {
        writeStatsInBackground(saveSingleStatsDraft(payload, mode, completedElapsedMs, nextGuessCompletedElapsedMs));
      } else {
        writeStatsInBackground(recordSingleSession(payload, mode, completedElapsedMs, nextGuessCompletedElapsedMs));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "超时空过失败。");
    } finally {
      setTimingOut(false);
    }
  }, [
    checkpoint,
    dailyDifficulty,
    endingSession,
    guessCompletedElapsedMs,
    isFinished,
    loading,
    mode,
    session,
    submitting,
    timingOut,
    turnLimitEnabled,
    turnLimitSeconds,
  ]);

  useEffect(() => {
    if (
      !session ||
      !turnLimitEnabled ||
      turnLimitSeconds <= 0 ||
      loading ||
      submitting ||
      endingSession ||
      timingOut ||
      isFinished
    ) {
      return;
    }
    if (currentTurnElapsedMs < turnLimitSeconds * 1000) return;
    void recordTimeout();
  }, [
    currentTurnElapsedMs,
    endingSession,
    isFinished,
    loading,
    recordTimeout,
    session,
    submitting,
    timingOut,
    turnLimitEnabled,
    turnLimitSeconds,
  ]);

  const forfeitSession = async () => {
    if (!session || loading || submitting || endingSession || timingOut || isFinished)
      return;
    if (!window.confirm("放弃后本局会立即判负且无法恢复，确定继续吗？")) return;
    setEndingSession(true);
    setMessage("");
    const completedElapsedMs = checkpoint();

    try {
      const payload = await api.forfeitSession(session.id);
      const nextGuessCompletedElapsedMs = guessCompletedElapsedMs.slice(0, payload.guesses.length);
      setSession(payload);
      setGuessCompletedElapsedMs(nextGuessCompletedElapsedMs);
      setInitialElapsedMs(completedElapsedMs);
      persistSession(mode, payload, nextGuessCompletedElapsedMs, completedElapsedMs, dailyDifficulty);
      if (mode === "daily") setDailyStatus(dailyDifficulty, payload.status);
      writeStatsInBackground(recordSingleSession(payload, mode, completedElapsedMs, nextGuessCompletedElapsedMs, "forfeit"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "放弃失败。");
    } finally {
      setEndingSession(false);
    }
  };

  const copyShare = async () => {
    if (!session || !isFinished) return;

    try {
      const sharePuzzleLabel =
        mode === "daily" && session.puzzleKey
          ? `每日题 ${session.puzzleKey} · ${QUESTION_DIFFICULTY_LABELS[dailyDifficulty]}`
          : puzzleLabel;
      await navigator.clipboard.writeText(
        createShareText(session, sharePuzzleLabel, window.location.origin),
      );
      globalMessage.success("分享文本已复制");
    } catch {
      globalMessage.error("复制失败，请检查浏览器的剪贴板权限");
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
            {mode === "daily" ? (
              <DailyDifficultyButtons
                active={dailyDifficulty}
                disabled={loading || submitting || endingSession || timingOut}
                statuses={dailyStatuses}
                onSelect={(difficulty) => void switchDailyDifficulty(difficulty)}
              />
            ) : null}
            <span className="progress-track" aria-hidden="true">
              <span
                style={{
                  width: `${guessProgressPercent}%`,
                }}
              />
            </span>
          </div>
          <div>
            <span className="label">本次猜测倒计时</span>
            <strong
              className={`tabular-nums ${
                turnLimitEnabled ? "text-vermilion" : "text-jade"
              }`}
            >
              {turnLimitEnabled && turnRemainingSeconds !== null
                ? formatDuration(turnRemainingSeconds)
                : "无限制"}
            </strong>
          </div>
          <div>
            <span className="label">计时</span>
            <strong>{formatDuration(currentElapsedSeconds)}</strong>
          </div>
          <div>
            <span className="label">进度</span>
            <strong className={hasUnlimitedGuesses ? "text-jade" : undefined}>
              {hasUnlimitedGuesses ? (
                "无限制"
              ) : (
                <>
                  {session?.guesses.length ?? 0}/{maxGuesses}
                </>
              )}
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
                disabled={loading || submitting || endingSession || timingOut}
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
                  || timingOut
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
                  timingOut ||
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
                              .map((color) => HAIR_COLOR_LABELS[color] ?? color)
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
          <div className="guess-form-actions">
            <button
              className="primary-button"
              type="submit"
              disabled={
                !selectedId ||
                loading ||
                submitting ||
                endingSession ||
                timingOut ||
                isFinished
              }
            >
              {submitting ? (
                <Loader2 className="spin" size={18} aria-hidden="true" />
              ) : (
                <Send size={18} aria-hidden="true" />
              )}
              <span>提交猜测</span>
            </button>
            <FeedbackLegendButton />
          </div>
        </form>

        {message ? <p className="message error">{message}</p> : null}

        <div className="table-wrap">
          <table className="guess-table">
            <thead>
              <tr>
                <th>角色</th>
                {visibleFields.map((field) => (
                  <th key={field.key}>{field.label}</th>
                ))}
                <th>本次猜测用时</th>
              </tr>
            </thead>
            <tbody>
              {session?.guesses.length ? (
                session.guesses.map((guess, index) => {
                  const timeout = guess.kind === "timeout";
                  return (
                    <tr
                      key={guess.guessId}
                      style={{ animationDelay: `${Math.min(index, 7) * 45}ms` }}
                    >
                      {timeout ? (
                        <th
                          scope="row"
                          colSpan={visibleFields.length + 1}
                          className="guess-timeout-cell"
                        >
                          <span>超时空过</span>
                        </th>
                      ) : (
                        <>
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
                                  <FeedbackStatusIcon status={feedback.status} />
                                </b>
                                <span>{formatFeedbackValue(feedback)}</span>
                              </span>
                            </td>
                          ))}
                        </>
                      )}
                      <td>
                        <span className="guess-duration">
                          {formatGuessDuration(
                            guessCompletedElapsedMs,
                            index,
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td
                    className="empty-state"
                    colSpan={visibleFields.length + 2}
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
          <div className="result-summary">
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
          {session.answer ? (
            <dl className="answer-details" aria-label="答案角色资料">
              <div>
                <dt>日文名</dt>
                <dd lang="ja">{session.answer.names.ja}</dd>
              </div>
              <div>
                <dt>首次登场作品</dt>
                <dd>{session.answer.firstAppearance.workTitle}</dd>
              </div>
              <div>
                <dt>种族</dt>
                <dd>{session.answer.species.join("、") || "暂无资料"}</dd>
              </div>
              <div>
                <dt>能力</dt>
                <dd>{session.answer.abilityDisplay}</dd>
              </div>
              <div>
                <dt>出现地点</dt>
                <dd>{session.answer.locations.join("、") || "暂无资料"}</dd>
              </div>
              <div>
                <dt>身份</dt>
                <dd>{session.answer.roles.join("、") || "暂无资料"}</dd>
              </div>
            </dl>
          ) : null}
          <div className="result-actions">
            {mode === "random" ? (
              <button
                className="primary-button"
                type="button"
                onClick={() => void requestFreshSession()}
                disabled={loading || submitting}
              >
                <RotateCcw size={18} aria-hidden="true" />
                <span>再来一局</span>
              </button>
            ) : null}
            <button
              className="secondary-button"
              type="button"
              onClick={() => void copyShare()}
            >
              <Copy size={18} aria-hidden="true" />
              <span>复制分享</span>
            </button>
          </div>
        </aside>
      ) : null}
    </>
  );
}
