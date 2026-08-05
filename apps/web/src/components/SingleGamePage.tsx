"use client";

import { useRouter } from "next/navigation";
import {
  Check,
  ChevronsDown,
  ChevronsUp,
  Copy,
  Flower2,
  Loader2,
  Minus,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  createShareText,
  GAME_CONTENT_DEFINITIONS,
  HAIR_COLOR_LABELS,
} from "@touhoufriberg/shared";
import type {
  FieldFeedback,
  PublicGameSession,
  SinglePlayerGameMode,
} from "@touhoufriberg/shared";
import { CharacterAvatar } from "./CharacterAvatar";
import { modeConfig, SINGLE_PLAYER_MODE_IDS } from "../gameModes";
import { useCharacterSearch } from "../hooks/useCharacterSearch";
import { api } from "../lib/api";

const CHARACTER_GAME = GAME_CONTENT_DEFINITIONS.character;
const GAME_SEARCH_RESULT_LIMIT = 12;

type StoredSession = { id: string; puzzleKey?: string };

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

export function SingleGamePage({ mode }: { mode: SinglePlayerGameMode }) {
  const router = useRouter();
  const [session, setSession] = useState<PublicGameSession | null>(null);
  const [puzzleLabel, setPuzzleLabel] = useState(modeConfig[mode].puzzleLabel);
  const [query, setQuery] = useState("");
  const { error: searchError, results } = useCharacterSearch(query, {
    limit: GAME_SEARCH_RESULT_LIMIT,
  });
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);

  const guessedIds = useMemo(
    () => new Set(session?.guesses.map((guess) => guess.guessId) ?? []),
    [session],
  );
  const isFinished = session?.status === "won" || session?.status === "lost";
  const showSuggestions =
    searchFocused &&
    query.trim().length > 0 &&
    !isFinished &&
    results.length > 0;

  const persistSession = (
    nextMode: SinglePlayerGameMode,
    nextSession: PublicGameSession,
  ) => {
    localStorage.setItem(
      modeConfig[nextMode].storageKey,
      JSON.stringify({
        id: nextSession.id,
        puzzleKey: nextSession.puzzleKey,
      } satisfies StoredSession),
    );
  };

  const loadSession = async (nextMode: SinglePlayerGameMode) => {
    setLoading(true);
    setMessage("");
    setShareMessage("");

    try {
      const dailyDateKey =
        nextMode === "daily"
          ? (await api.catalog()).dailyDateKey
          : undefined;
      const storedValue = localStorage.getItem(modeConfig[nextMode].storageKey);
      if (storedValue) {
        try {
          const storedSession = parseStoredSession(storedValue);
          const restored = await api.getSession(storedSession.id);
          if (
            nextMode === "daily" &&
            restored.puzzleKey !== dailyDateKey
          ) {
            throw new Error("每日题日期已经更新。");
          }
          setSession(restored);
          setPuzzleLabel(
            nextMode === "daily"
              ? `${modeConfig[nextMode].label} ${restored.puzzleKey}`
              : modeConfig[nextMode].puzzleLabel,
          );
          return;
        } catch {
          localStorage.removeItem(modeConfig[nextMode].storageKey);
        }
      }

      const created = await api.createPuzzle(nextMode);
      setSession(created.session);
      setPuzzleLabel(created.puzzleLabel);
      persistSession(nextMode, created.session);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载游戏失败。");
    } finally {
      setLoading(false);
    }
  };

  const startFresh = async (nextMode = mode) => {
    localStorage.removeItem(modeConfig[nextMode].storageKey);
    await loadSession(nextMode);
  };

  useEffect(() => {
    void loadSession(mode);
  }, [mode]);

  const submitGuess = async (guessId = selectedId) => {
    if (!session || !guessId || submitting || isFinished) return;
    setSubmitting(true);
    setMessage("");
    setShareMessage("");

    try {
      const payload = await api.submitGuess(session.id, guessId);
      setSession(payload);
      persistSession(mode, payload);
      setQuery("");
      setSelectedId("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "提交失败。");
    } finally {
      setSubmitting(false);
    }
  };

  const copyShare = async () => {
    if (!session) return;
    const text = createShareText(session, puzzleLabel, window.location.origin);
    await navigator.clipboard.writeText(text);
    setShareMessage("分享文本已复制。");
  };

  return (
    <>
      <section className="game-surface" aria-label="TouhouFlandre 游戏区域">
        <header className="topbar">
          <div className="game-title">
            <span className="game-emblem">
              <Flower2 size={22} aria-hidden="true" />
            </span>
            <div>
              <p className="kicker">{modeConfig[mode].eyebrow}</p>
              <h1>东方芙一把</h1>
            </div>
          </div>
          <div className="mode-tabs" role="tablist" aria-label="游戏模式">
            {SINGLE_PLAYER_MODE_IDS.map((modeKey) => {
              const Icon = modeConfig[modeKey].icon;
              return (
                <button
                  className={mode === modeKey ? "mode-tab active" : "mode-tab"}
                  key={modeKey}
                  type="button"
                  onClick={() => router.push(`/single/${modeKey}`)}
                  title={modeConfig[modeKey].label}
                  aria-selected={mode === modeKey}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{modeConfig[modeKey].label}</span>
                </button>
              );
            })}
          </div>
        </header>

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
          <button
            className="icon-button"
            type="button"
            onClick={() => void startFresh()}
            title="重新开始"
          >
            <RotateCcw size={18} aria-hidden="true" />
          </button>
        </div>

        <form
          className="guess-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submitGuess();
          }}
        >
          <div className="search-combobox">
            <label className="search-box">
              <Search size={18} aria-hidden="true" />
              <input
                value={query}
                onFocus={() => setSearchFocused(true)}
                onBlur={() =>
                  window.setTimeout(() => setSearchFocused(false), 120)
                }
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedId("");
                }}
                disabled={loading || submitting || isFinished}
                placeholder="输入角色名、别名或初登场作品"
                aria-label="搜索东方角色"
                aria-autocomplete="list"
                aria-expanded={showSuggestions}
              />
            </label>
            {showSuggestions ? (
              <div
                className="suggestion-list"
                role="listbox"
                aria-label="搜索建议"
              >
                {results.map((result) => {
                  const disabled = guessedIds.has(result.id);
                  return (
                    <button
                      className={
                        selectedId === result.id
                          ? "suggestion selected"
                          : "suggestion"
                      }
                      key={result.id}
                      type="button"
                      disabled={disabled}
                      role="option"
                      aria-selected={selectedId === result.id}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setSelectedId(result.id);
                        setQuery(result.name);
                        setSearchFocused(false);
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
                })}
              </div>
            ) : null}
          </div>
          <button
            className="primary-button"
            type="submit"
            disabled={!selectedId || loading || submitting || isFinished}
          >
            {submitting ? (
              <Loader2 className="spin" size={18} aria-hidden="true" />
            ) : (
              <Search size={18} aria-hidden="true" />
            )}
            <span>提交猜测</span>
          </button>
        </form>

        {message || searchError ? (
          <p className="message error">{message || searchError}</p>
        ) : null}
        {shareMessage ? (
          <p className="message success">{shareMessage}</p>
        ) : null}

        <div className="table-wrap">
          <table className="guess-table">
            <thead>
              <tr>
                <th>角色</th>
                {CHARACTER_GAME.fields.map((field) => (
                  <th key={field.key}>{field.label}</th>
                ))}
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
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    className="empty-state"
                    colSpan={CHARACTER_GAME.fields.length + 1}
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
            <h2>{session.status === "won" ? "猜中了" : "答案揭晓"}</h2>
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
          <div className="result-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => void copyShare()}
            >
              <Copy size={18} aria-hidden="true" />
              <span>复制分享</span>
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() => void startFresh()}
            >
              <RotateCcw size={18} aria-hidden="true" />
              <span>再来一局</span>
            </button>
          </div>
        </aside>
      ) : null}
    </>
  );
}
