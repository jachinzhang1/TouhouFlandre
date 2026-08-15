"use client";

import {
  Check,
  Copy,
  Flag,
  Loader2,
  Play,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import {
  QUESTION_DIFFICULTY_LABELS,
  QUESTION_DIFFICULTY_PRESETS,
  type FieldFeedback,
  type PublicGameSession,
  type QuestionDifficultyPreset,
  type SinglePlayerGameMode,
} from "@touhouflandre/shared";
import { CharacterAvatar } from "../game/CharacterAvatar";
import { FeedbackStatusIcon } from "../game/FeedbackStatusIcon";
import { Paper } from "../Paper";
import { PaperButton } from "../controls/PaperButton";

export type DailySessionStatus = "won" | "lost" | "playing" | null;

export function SingleGameStatusBar({
  mode,
  puzzleLabel,
  dailyDifficulty,
  dailyStatuses,
  disabled,
  turnLimitEnabled,
  turnRemainingSeconds,
  elapsedSeconds,
  guessCount,
  maxGuesses,
  unlimitedGuesses,
  sessionStatus,
  progressPercent,
  onDifficultyChange,
  onRestart,
  onForfeit,
}: {
  mode: SinglePlayerGameMode;
  puzzleLabel: string;
  dailyDifficulty: QuestionDifficultyPreset;
  dailyStatuses: Record<QuestionDifficultyPreset, DailySessionStatus>;
  disabled: boolean;
  turnLimitEnabled: boolean;
  turnRemainingSeconds: number | null;
  elapsedSeconds: number;
  guessCount: number;
  maxGuesses: number;
  unlimitedGuesses: boolean;
  sessionStatus: PublicGameSession["status"] | undefined;
  progressPercent: number;
  onDifficultyChange: (difficulty: QuestionDifficultyPreset) => void;
  onRestart: () => void;
  onForfeit: () => void;
}) {
  return (
    <Paper
      animateOnMount={false}
      as="div"
      className={`status-strip ${mode}`}
      foldSize={16}
      sticker={false}
      variant="tinted"
    >
      <div className="puzzle-status">
        <span className="label">{mode === "daily" ? "每日题" : "随机题"}</span>
        <strong className="single-game-puzzle-title">{puzzleLabel}</strong>
        <span className="progress-track" aria-hidden="true">
          <span style={{ width: `${progressPercent}%` }} />
        </span>
      </div>

      {mode === "daily" ? (
        <DailyDifficultyButtons
          active={dailyDifficulty}
          disabled={disabled}
          statuses={dailyStatuses}
          onSelect={onDifficultyChange}
        />
      ) : null}

      <dl className="single-game-metrics">
        <div>
          <dt>本次时限</dt>
          <dd
            className={`tabular-nums ${
              turnLimitEnabled ? "text-vermilion" : "text-jade"
            }`}
          >
            {turnLimitEnabled && turnRemainingSeconds !== null
              ? formatDuration(turnRemainingSeconds)
              : "无限制"}
          </dd>
        </div>
        <div>
          <dt>计时</dt>
          <dd className="tabular-nums">{formatDuration(elapsedSeconds)}</dd>
        </div>
        <div>
          <dt>进度</dt>
          <dd className={unlimitedGuesses ? "text-jade" : undefined}>
            {unlimitedGuesses ? "无限制" : `${guessCount}/${maxGuesses}`}
          </dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd
            aria-live="polite"
            className={`session-state ${sessionStatus ?? "playing"}`}
          >
            {sessionStatus === "won"
              ? "已猜中"
              : sessionStatus === "lost"
                ? "未猜中"
                : "进行中"}
          </dd>
        </div>
      </dl>

      <div className="status-actions">
        {mode === "random" ? (
          <PaperButton
            ariaLabel="重新开始随机题"
            compact
            disabled={disabled}
            iconOnly
            onClick={onRestart}
            title="重新开始"
            tone="theme"
          >
            <RotateCcw size={17} aria-hidden="true" />
          </PaperButton>
        ) : null}
        <PaperButton
          ariaLabel="放弃本局"
          compact
          disabled={disabled || !sessionStatus || sessionStatus !== "playing"}
          iconOnly
          onClick={onForfeit}
          title="放弃本局"
          tone="danger"
        >
          <Flag size={17} aria-hidden="true" />
        </PaperButton>
      </div>
    </Paper>
  );
}

export function SingleGuessHistory({
  session,
  visibleFields,
  guessCompletedElapsedMs,
  loading,
  message,
}: {
  session: PublicGameSession | null;
  visibleFields: { key: string; label: string }[];
  guessCompletedElapsedMs: number[];
  loading: boolean;
  message: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const guessCount = session?.guesses.length ?? 0;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || guessCount === 0) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [guessCount]);

  return (
    <div
      aria-label="猜测记录"
      className="single-game-history-scroll"
      data-guess-count={guessCount}
      ref={viewportRef}
      role="region"
    >
      {guessCount > 0 ? (
        <Paper
          animateOnMount={false}
          as="div"
          className="single-game-history-table-paper"
          folded={false}
          sticker={false}
          unfoldOnHover={false}
          variant="plain"
        >
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
              {session!.guesses.map((guess, index) => {
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
                        {formatGuessDuration(guessCompletedElapsedMs, index)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Paper>
      ) : (
        <div className="empty-state" role="status">
          {loading ? (
            <span>
              <Loader2 className="spin" size={20} aria-hidden="true" />{" "}
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
        </div>
      )}
    </div>
  );
}

export function SingleGameResult({
  mode,
  session,
  disabled,
  onRestart,
  onShare,
}: {
  mode: SinglePlayerGameMode;
  session: PublicGameSession;
  disabled: boolean;
  onRestart: () => void;
  onShare: () => void;
}) {
  return (
    <aside className="single-game-result-layer" aria-label="游戏结果">
      <Paper
        animateOnMount={false}
        as="div"
        className="result-panel"
        foldSize={18}
        sticker={false}
        variant="plain"
      >
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
            <PaperButton
              disabled={disabled}
              filled
              onClick={onRestart}
              tone="theme"
            >
              <RotateCcw size={18} aria-hidden="true" />
              <span>再来一局</span>
            </PaperButton>
          ) : null}
          <PaperButton onClick={onShare} tone="plain">
            <Copy size={18} aria-hidden="true" />
            <span>复制分享</span>
          </PaperButton>
        </div>
      </Paper>
    </aside>
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
    <div
      className="single-game-difficulties"
      role="group"
      aria-label="每日题难度"
    >
      {QUESTION_DIFFICULTY_PRESETS.map((difficulty) => {
        const status = statuses[difficulty];
        const selected = active === difficulty;
        return (
          <Paper
            animateOnMount={false}
            ariaPressed={selected}
            as="button"
            className={`single-game-difficulty${selected ? " is-active" : ""}${
              status === "won" ? " is-won" : status === "lost" ? " is-lost" : ""
            }`}
            disabled={disabled && !selected}
            folded={selected}
            foldSize={8}
            key={difficulty}
            onClick={() => onSelect(difficulty)}
            sticker={false}
            variant={selected ? "tinted" : "plain"}
          >
            <span>{QUESTION_DIFFICULTY_LABELS[difficulty]}</span>
            {status === "won" ? (
              <Check size={13} aria-hidden="true" />
            ) : status === "lost" ? (
              <X size={13} aria-hidden="true" />
            ) : (
              <Play size={12} aria-hidden="true" />
            )}
          </Paper>
        );
      })}
    </div>
  );
}

function feedbackClass(feedback: FieldFeedback) {
  return `feedback feedback-${feedback.status}`;
}

function formatFeedbackValue(feedback: FieldFeedback) {
  return feedback.displayValue.join("、");
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatGuessDuration(timings: number[], index: number) {
  const end = timings[index];
  if (end === undefined) return "--:--";
  const start = index === 0 ? 0 : (timings[index - 1] ?? 0);
  return formatDuration(Math.max(0, Math.round((end - start) / 1000)));
}
