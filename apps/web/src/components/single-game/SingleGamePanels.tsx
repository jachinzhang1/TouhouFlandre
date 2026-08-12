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
import {
  QUESTION_DIFFICULTY_LABELS,
  QUESTION_DIFFICULTY_PRESETS,
  type FieldFeedback,
  type PublicGameSession,
  type QuestionDifficultyPreset,
  type SinglePlayerGameMode,
} from "@touhouflandre/shared";
import { CharacterAvatar } from "../CharacterAvatar";
import { FeedbackStatusIcon } from "../FeedbackStatusIcon";

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
    <div className="status-strip">
      <div className="puzzle-status">
        <span className="label">题目</span>
        <strong>{puzzleLabel}</strong>
        {mode === "daily" ? (
          <DailyDifficultyButtons
            active={dailyDifficulty}
            disabled={disabled}
            statuses={dailyStatuses}
            onSelect={onDifficultyChange}
          />
        ) : null}
        <span className="progress-track" aria-hidden="true">
          <span style={{ width: `${progressPercent}%` }} />
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
        <strong>{formatDuration(elapsedSeconds)}</strong>
      </div>
      <div>
        <span className="label">进度</span>
        <strong className={unlimitedGuesses ? "text-jade" : undefined}>
          {unlimitedGuesses ? "无限制" : `${guessCount}/${maxGuesses}`}
        </strong>
      </div>
      <div>
        <span className="label">状态</span>
        <strong className={`session-state ${sessionStatus ?? "playing"}`}>
          {sessionStatus === "won"
            ? "已猜中"
            : sessionStatus === "lost"
              ? "未猜中"
              : "进行中"}
        </strong>
      </div>
      <div className="status-actions">
        {mode === "random" ? (
          <button
            className="icon-button"
            type="button"
            onClick={onRestart}
            title="重新开始"
            aria-label="重新开始随机题"
            disabled={disabled}
          >
            <RotateCcw size={18} aria-hidden="true" />
          </button>
        ) : null}
        <button
          className="icon-button"
          type="button"
          onClick={onForfeit}
          title="放弃本局"
          aria-label="放弃本局"
          disabled={disabled || !sessionStatus || sessionStatus !== "playing"}
        >
          <Flag size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
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
  return (
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
                      {formatGuessDuration(guessCompletedElapsedMs, index)}
                    </span>
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td className="empty-state" colSpan={visibleFields.length + 2}>
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
              </td>
            </tr>
          )}
        </tbody>
      </table>
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
            onClick={onRestart}
            disabled={disabled}
          >
            <RotateCcw size={18} aria-hidden="true" />
            <span>再来一局</span>
          </button>
        ) : null}
        <button className="secondary-button" type="button" onClick={onShare}>
          <Copy size={18} aria-hidden="true" />
          <span>复制分享</span>
        </button>
      </div>
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
      className="mt-2 flex flex-wrap gap-1.5"
      role="group"
      aria-label="每日题难度"
    >
      {QUESTION_DIFFICULTY_PRESETS.map((difficulty) => {
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
