"use client";

import { Loader2, Search, Send } from "lucide-react";
import { message as antdMessage } from "antd";
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
  QuestionDifficultyPreset,
  PublicGameSession,
  SinglePlayerGameMode,
} from "@touhouflandre/shared";
import { CharacterAvatar } from "../game/CharacterAvatar";
import {
  SingleGameResult,
  SingleGameStatusBar,
  SingleGuessHistory,
  type DailySessionStatus,
} from "./SingleGamePanels";
import { modeConfig } from "../../gameModes";
import { useCharacterSearch } from "../../hooks/useCharacterSearch";
import { api } from "../../lib/api";
import { useForegroundTimer, useWallClockTimer } from "../../stats/timer";
import {
  loadSingleStatsDraft,
  recordSingleSession,
  saveSingleStatsDraft,
} from "../../stats/singleRecorder";
import {
  catalogFullToSnapshot,
  loadLocalQuestionScope,
} from "../../lib/questionScopeStorage";
import {
  buildSingleGameSeed,
  installGameSeedConsole,
  parseSingleGameResultSeed,
  parseSingleGameSeedPreset,
  SINGLE_GAME_SEED_PRESETS,
  SINGLE_GAME_RESULT_SEEDS,
} from "../../dev/gameSeeds";
import { PaperSearchInput } from "../controls/PaperSearchInput";
import { Paper } from "../Paper";
import { FeedbackLegend } from "../game/FeedbackLegend";
import { PaperButton } from "../controls/PaperButton";
import {
  PaperSegmentGroup,
  PaperSegmentSeparator,
} from "../controls/PaperSegmentedControl";

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

const dailyStorageKey = (difficulty: QuestionDifficultyPreset) =>
  difficulty === DEFAULT_DAILY_DIFFICULTY
    ? modeConfig.daily.storageKey
    : `${modeConfig.daily.storageKey}:${difficulty}`;

const storageKeyForMode = (
  mode: SinglePlayerGameMode,
  difficulty: QuestionDifficultyPreset,
) =>
  mode === "daily" ? dailyStorageKey(difficulty) : modeConfig[mode].storageKey;

const emptyDailyStatuses = (): Record<
  QuestionDifficultyPreset,
  DailySessionStatus
> => ({
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
      const width = Math.min(640, rect.width, window.innerWidth - margin * 2);
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
      className="suggestion-list-positioner"
      id={id}
      role="listbox"
      aria-label="搜索建议"
      style={position}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Paper
        animateOnMount={false}
        as="div"
        className="suggestion-list paper-data-table"
        folded={false}
        sticker={false}
        unfoldOnHover={false}
        variant="plain"
      >
        <div className="suggestion-list-body paper-data-table-body">
          {children}
        </div>
      </Paper>
    </div>,
    document.body,
  );
}

export function SingleGamePage({ mode }: { mode: SinglePlayerGameMode }) {
  const [messageApi, messageContextHolder] = antdMessage.useMessage();
  const listboxId = useId();
  const searchBoxRef = useRef<HTMLLabelElement>(null);
  const loadRequestIdRef = useRef(0);
  const developmentSeedActiveRef = useRef(false);
  const developmentResultReplayRef = useRef(0);
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
    sessionId: developmentSeedActiveRef.current ? undefined : session?.id,
    version: developmentSeedActiveRef.current
      ? undefined
      : (session?.catalogVersion ?? undefined),
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
  const [guessCompletedElapsedMs, setGuessCompletedElapsedMs] = useState<
    number[]
  >([]);
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
  const timerStarted = Boolean(session && hasGuessRecords && !isFinished);
  const useWallClockElapsed = mode === "daily" && hasGuessRecords;
  const foregroundTimer = useForegroundTimer(
    session?.id ?? "none",
    timerStarted && !useWallClockElapsed,
    initialElapsedMs,
  );
  const wallClockTimer = useWallClockTimer(
    session?.id ?? "none",
    timerStarted && useWallClockElapsed,
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
  const currentTurnElapsedMs =
    session && !isFinished ? Math.max(0, elapsedMs - turnStartElapsedMs) : 0;
  const turnRemainingSeconds = turnLimitEnabled
    ? Math.max(0, turnLimitSeconds - Math.floor(currentTurnElapsedMs / 1000))
    : null;
  const selectableResults = useMemo(
    () => results.filter((result) => !guessedIds.has(result.id)),
    [guessedIds, results],
  );
  const gameInputDisabled =
    loading ||
    submitting ||
    endingSession ||
    timingOut ||
    !session ||
    isFinished;
  const submitDisabled = gameInputDisabled || !selectedId;
  const showSuggestions =
    !suggestionsDismissed && query.trim().length > 0 && !gameInputDisabled;
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
          if (restored.puzzleKey !== dateKey)
            return [difficulty, null] as const;
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
      const storedValue = localStorage.getItem(
        storageKeyForMode(nextMode, difficulty),
      );
      if (storedValue) {
        try {
          const storedSession = parseStoredSession(storedValue);
          const restored = await api.getSession(storedSession.id);
          if (!isCurrentRequest()) return;
          if (nextMode === "daily" && restored.puzzleKey !== dailyDateKey) {
            const oldTimings = normalizeGuessTimings(
              storedSession.guessCompletedElapsedMs ??
                storedSession.guessCompletedElapsedSeconds?.map(
                  (value) => value * 1000,
                ),
              restored.guesses.length,
            );
            const oldElapsed = Math.max(
              0,
              storedSession.activeElapsedMs ?? oldTimings.at(-1) ?? 0,
            );
            if (restored.status === "playing" && restored.guesses.length > 0) {
              try {
                const forfeited = await api.forfeitSession(restored.id);
                writeStatsInBackground(
                  recordSingleSession(
                    forfeited,
                    nextMode,
                    oldElapsed,
                    oldTimings,
                    "abandoned",
                  ),
                );
              } catch {
                // 跨日旧会话可能已过期；不阻塞创建当天新题。
              }
            } else if (restored.status !== "playing") {
              writeStatsInBackground(
                recordSingleSession(restored, nextMode, oldElapsed, oldTimings),
              );
            }
            localStorage.removeItem(storageKeyForMode(nextMode, difficulty));
          } else {
            const localTimings = normalizeGuessTimings(
              storedSession.guessCompletedElapsedMs ??
                storedSession.guessCompletedElapsedSeconds?.map(
                  (value) => value * 1000,
                ),
              restored.guesses.length,
            );
            const draft = await loadSingleStatsDraft(restored.id);
            const restoredTimings = localTimings.length
              ? localTimings
              : normalizeGuessTimings(
                  draft?.guessCompletedElapsedMs,
                  restored.guesses.length,
                );
            const baseElapsed = Math.max(
              storedSession.activeElapsedMs ?? 0,
              draft?.activeElapsedMs ?? 0,
              restoredTimings.at(-1) ?? 0,
            );
            const savedAtMs =
              validTimestamp(storedSession.savedAtMs) ??
              validTimestamp(
                draft?.updatedAt ? Date.parse(draft.updatedAt) : undefined,
              );
            const restoredElapsed =
              restored.guesses.length === 0
                ? 0
                : nextMode === "daily" &&
                    restored.status === "playing" &&
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
            if (nextMode === "daily")
              setDailyStatus(difficulty, restored.status);
            if (restored.status !== "playing") {
              writeStatsInBackground(
                recordSingleSession(
                  restored,
                  nextMode,
                  restoredElapsed,
                  restoredTimings,
                ),
              );
            } else {
              writeStatsInBackground(
                saveSingleStatsDraft(
                  restored,
                  nextMode,
                  restoredElapsed,
                  restoredTimings,
                ),
              );
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
          ? dailyPuzzleLabel(
              created.session.puzzleKey ?? dailyDateKey,
              difficulty,
            )
          : created.puzzleLabel,
      );
      persistSession(nextMode, created.session, [], 0, difficulty);
      if (nextMode === "daily")
        setDailyStatus(difficulty, created.session.status);
      writeStatsInBackground(
        saveSingleStatsDraft(created.session, nextMode, 0, []),
      );
    } catch (error) {
      if (!isCurrentRequest()) return;
      setMessage(error instanceof Error ? error.message : "加载游戏失败。");
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  };

  useEffect(() => {
    const applySeed = (seed: ReturnType<typeof buildSingleGameSeed>) => {
      setSession(seed.session);
      setPuzzleLabel(seed.puzzleLabel);
      setLoading(seed.loading);
      setSubmitting(false);
      setEndingSession(false);
      setTimingOut(false);
      setMessage(seed.message);
      setQuery("");
      setSelectedId("");
      setActiveSuggestionId("");
      setSuggestionsDismissed(false);
      setInitialElapsedMs(seed.initialElapsedMs);
      setGuessCompletedElapsedMs(seed.guessCompletedElapsedMs);
      setDailyDifficulty(seed.dailyDifficulty);
      setDailyStatuses(seed.dailyStatuses);
    };

    return installGameSeedConsole({
      page: "singleplayer",
      presets: SINGLE_GAME_SEED_PRESETS,
      resultPresets: SINGLE_GAME_RESULT_SEEDS,
      seed: (value) => {
        const preset = parseSingleGameSeedPreset(value);
        developmentResultReplayRef.current += 1;
        loadRequestIdRef.current += 1;
        developmentSeedActiveRef.current = true;
        applySeed(buildSingleGameSeed(preset, mode));
        return preset;
      },
      seedResult: async (value) => {
        const result = parseSingleGameResultSeed(value);
        const replayId = ++developmentResultReplayRef.current;
        loadRequestIdRef.current += 1;
        developmentSeedActiveRef.current = true;
        applySeed(buildSingleGameSeed("playing", mode));
        await new Promise<void>((resolve) => window.setTimeout(resolve, 80));
        if (developmentResultReplayRef.current === replayId) {
          applySeed(buildSingleGameSeed(result, mode));
        }
        return result;
      },
      reset: () => {
        developmentResultReplayRef.current += 1;
        developmentSeedActiveRef.current = false;
        void loadSession(mode, dailyDifficulty);
      },
    });
  }, [dailyDifficulty, mode]);

  const startFresh = async (nextMode = mode, difficulty = dailyDifficulty) => {
    localStorage.removeItem(storageKeyForMode(nextMode, difficulty));
    await loadSession(nextMode, difficulty);
  };

  const requestFreshSession = async () => {
    if (developmentSeedActiveRef.current) {
      developmentSeedActiveRef.current = false;
      await startFresh("random");
      return;
    }
    if (
      mode !== "random" ||
      loading ||
      submitting ||
      endingSession ||
      timingOut
    )
      return;
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
      writeStatsInBackground(
        recordSingleSession(
          forfeited,
          mode,
          completedElapsedMs,
          guessCompletedElapsedMs,
          "abandoned",
        ),
      );
    }
    await startFresh("random");
  };

  const switchDailyDifficulty = async (
    difficulty: QuestionDifficultyPreset,
  ) => {
    if (developmentSeedActiveRef.current) {
      developmentSeedActiveRef.current = false;
      await loadSession("daily", difficulty);
      return;
    }
    if (mode !== "daily" || loading || submitting || endingSession || timingOut)
      return;
    if (session && !isFinished) {
      if (session.guesses.length === 0) {
        persistSession("daily", session, [], 0, dailyDifficulty);
      } else {
        const activeElapsedMs = checkpoint();
        persistSession(
          "daily",
          session,
          guessCompletedElapsedMs,
          activeElapsedMs,
          dailyDifficulty,
        );
        writeStatsInBackground(
          saveSingleStatsDraft(
            session,
            "daily",
            activeElapsedMs,
            guessCompletedElapsedMs,
          ),
        );
      }
    }
    await loadSession("daily", difficulty);
  };

  useEffect(() => {
    developmentSeedActiveRef.current = false;
    void loadSession(mode, DEFAULT_DAILY_DIFFICULTY);
    return () => {
      loadRequestIdRef.current += 1;
    };
  }, [mode]);

  useEffect(() => {
    if (!session || isFinished || developmentSeedActiveRef.current) return;
    const flush = () => {
      if (
        mode === "daily" &&
        session.status === "playing" &&
        session.guesses.length === 0
      ) {
        persistSession(mode, session, [], 0, dailyDifficulty);
        return;
      }
      const activeElapsedMs = checkpoint();
      persistSession(
        mode,
        session,
        guessCompletedElapsedMs,
        activeElapsedMs,
        dailyDifficulty,
      );
      writeStatsInBackground(
        saveSingleStatsDraft(
          session,
          mode,
          activeElapsedMs,
          guessCompletedElapsedMs,
        ),
      );
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
  }, [
    session,
    isFinished,
    mode,
    guessCompletedElapsedMs,
    checkpoint,
    dailyDifficulty,
  ]);

  const submitGuess = async (guessId = selectedId) => {
    if (developmentSeedActiveRef.current) {
      setMessage(
        "调试种子为只读；请切换种子或运行 __touhouflandreDev.game.reset() 恢复真实题局。",
      );
      return;
    }
    if (!session || !guessId || submitting || timingOut || isFinished) return;
    setSubmitting(true);
    setMessage("");
    const completedElapsedMs = checkpoint();

    try {
      const payload = await api.submitGuess(session.id, guessId);
      const nextGuessCompletedElapsedMs = [
        ...guessCompletedElapsedMs,
        completedElapsedMs,
      ].slice(0, payload.guesses.length);
      setSession(payload);
      setGuessCompletedElapsedMs(nextGuessCompletedElapsedMs);
      setInitialElapsedMs(completedElapsedMs);
      persistSession(
        mode,
        payload,
        nextGuessCompletedElapsedMs,
        completedElapsedMs,
        dailyDifficulty,
      );
      if (mode === "daily") setDailyStatus(dailyDifficulty, payload.status);
      if (payload.status === "playing") {
        writeStatsInBackground(
          saveSingleStatsDraft(
            payload,
            mode,
            completedElapsedMs,
            nextGuessCompletedElapsedMs,
          ),
        );
      } else {
        writeStatsInBackground(
          recordSingleSession(
            payload,
            mode,
            completedElapsedMs,
            nextGuessCompletedElapsedMs,
          ),
        );
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
      developmentSeedActiveRef.current ||
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
      const payload = await api.timeoutSession(session.id);
      const nextGuessCompletedElapsedMs = [
        ...guessCompletedElapsedMs,
        completedElapsedMs,
      ].slice(0, payload.guesses.length);
      setSession(payload);
      setGuessCompletedElapsedMs(nextGuessCompletedElapsedMs);
      setInitialElapsedMs(completedElapsedMs);
      persistSession(
        mode,
        payload,
        nextGuessCompletedElapsedMs,
        completedElapsedMs,
        dailyDifficulty,
      );
      if (mode === "daily") setDailyStatus(dailyDifficulty, payload.status);
      if (payload.status === "playing") {
        writeStatsInBackground(
          saveSingleStatsDraft(
            payload,
            mode,
            completedElapsedMs,
            nextGuessCompletedElapsedMs,
          ),
        );
      } else {
        writeStatsInBackground(
          recordSingleSession(
            payload,
            mode,
            completedElapsedMs,
            nextGuessCompletedElapsedMs,
          ),
        );
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
    if (developmentSeedActiveRef.current) {
      setMessage(
        "调试种子为只读；请切换种子或运行 __touhouflandreDev.game.reset() 恢复真实题局。",
      );
      return;
    }
    if (
      !session ||
      loading ||
      submitting ||
      endingSession ||
      timingOut ||
      isFinished
    )
      return;
    setEndingSession(true);
    setMessage("");
    const completedElapsedMs = checkpoint();

    try {
      const payload = await api.forfeitSession(session.id);
      const nextGuessCompletedElapsedMs = guessCompletedElapsedMs.slice(
        0,
        payload.guesses.length,
      );
      setSession(payload);
      setGuessCompletedElapsedMs(nextGuessCompletedElapsedMs);
      setInitialElapsedMs(completedElapsedMs);
      persistSession(
        mode,
        payload,
        nextGuessCompletedElapsedMs,
        completedElapsedMs,
        dailyDifficulty,
      );
      if (mode === "daily") setDailyStatus(dailyDifficulty, payload.status);
      writeStatsInBackground(
        recordSingleSession(
          payload,
          mode,
          completedElapsedMs,
          nextGuessCompletedElapsedMs,
          "forfeit",
        ),
      );
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
      messageApi.success("分享文本已复制");
    } catch {
      messageApi.error("复制失败，请检查浏览器的剪贴板权限");
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
    <section
      className={`single-game-shell ${mode}`}
      aria-label="TouhouFlandre 游戏区域"
      data-suggestions-open={showSuggestions ? "true" : "false"}
    >
      {messageContextHolder}
      <div className="single-game-history-region">
        <SingleGuessHistory
          session={session}
          visibleFields={visibleFields}
          guessCompletedElapsedMs={guessCompletedElapsedMs}
          loading={loading}
          message={message}
        />
        {session && isFinished ? (
          <SingleGameResult
            mode={mode}
            session={session}
            disabled={loading || submitting}
            onRestart={() => void requestFreshSession()}
            onShare={() => void copyShare()}
          />
        ) : null}
      </div>
      <FeedbackLegend className="single-game-feedback-legend" />
      <div className="single-game-input-group">
        <form
          className="guess-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submitGuess();
          }}
        >
          <PaperSegmentGroup
            className="single-game-guess-group"
            label="猜测操作"
          >
            <div className="search-combobox">
              <PaperSearchInput
                aria-activedescendant={
                  showSuggestions && activeSuggestionId
                    ? `${listboxId}-${activeSuggestionId}`
                    : undefined
                }
                aria-autocomplete="list"
                aria-controls={listboxId}
                aria-expanded={showSuggestions}
                ariaLabel="搜索东方角色"
                className="single-game-search-control"
                containerRef={searchBoxRef}
                disabled={gameInputDisabled}
                folded={false}
                onBlur={() => setActiveSuggestionId("")}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedId("");
                  setActiveSuggestionId("");
                  setSuggestionsDismissed(false);
                }}
                onFocus={() => setSuggestionsDismissed(false)}
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
                placeholder="输入角色名、别名或初登场作品"
                value={query}
              />
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
                  <div
                    className="suggestion-state suggestion-error"
                    role="alert"
                  >
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
                        className={`suggestion paper-data-table-row${
                          active ? " selected" : ""
                        }`}
                        id={`${listboxId}-${result.id}`}
                        key={result.id}
                        type="button"
                        tabIndex={-1}
                        disabled={disabled}
                        role="option"
                        aria-selected={active}
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={() => selectSuggestion(result)}
                      >
                        <span className="suggestion-avatar-cell">
                          <CharacterAvatar
                            avatarUrl={result.avatarUrl}
                            name={result.name}
                            initials={result.initials}
                            className="suggestion-avatar"
                          />
                        </span>
                        <span className="suggestion-main">
                          <strong>{result.name}</strong>
                          <small>{result.subtitle}</small>
                        </span>
                        <span className="suggestion-meta">
                          {disabled
                            ? "已猜"
                            : result.hairColors
                                .map(
                                  (color) => HAIR_COLOR_LABELS[color] ?? color,
                                )
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
            <PaperSegmentSeparator />
            <PaperButton
              className="single-game-submit"
              disabled={submitDisabled}
              filled={!submitDisabled}
              folded={!submitDisabled}
              onClick={() => void submitGuess()}
              tone="theme"
            >
              {submitting ? (
                <Loader2 className="spin" size={18} aria-hidden="true" />
              ) : (
                <Send size={18} aria-hidden="true" />
              )}
              <span>提交猜测</span>
            </PaperButton>
          </PaperSegmentGroup>
        </form>

        {message ? <p className="message error">{message}</p> : null}
      </div>

      <SingleGameStatusBar
        mode={mode}
        puzzleLabel={puzzleLabel}
        dailyDifficulty={dailyDifficulty}
        dailyStatuses={dailyStatuses}
        disabled={loading || submitting || endingSession || timingOut}
        turnLimitEnabled={turnLimitEnabled}
        turnRemainingSeconds={turnRemainingSeconds}
        elapsedSeconds={currentElapsedSeconds}
        guessCount={session?.guesses.length ?? 0}
        maxGuesses={maxGuesses}
        unlimitedGuesses={hasUnlimitedGuesses}
        sessionStatus={session?.status}
        onDifficultyChange={(difficulty) =>
          void switchDailyDifficulty(difficulty)
        }
        onRestart={() => void requestFreshSession()}
        onForfeit={() => void forfeitSession()}
      />
    </section>
  );
}
