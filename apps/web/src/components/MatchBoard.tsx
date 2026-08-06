"use client";

// 对局视图（08 §10.2）：比分条 + 双棋盘布局（单人在上、对手在下；窄屏堆叠）。
import type { components } from "../generated/api";

type MatchView = components["schemas"]["MatchView"];
type RoundView = components["schemas"]["RoundView"];
import type { RoundEndedPayload } from "@touhoufriberg/shared";
import { useRoomClock, formatRemaining } from "../hooks/useRoomClock";
import { ROOM_FORMAT_SHORT } from "../domain/multiRoom";
import { OpponentBoard } from "./OpponentBoard";
import { SelfBoard } from "./SelfBoard";

export function MatchBoard({
  format,
  match,
  round,
  mySlot,
  roundResult,
  onGuess,
  disabled,
}: {
  format: string;
  match: MatchView;
  round: RoundView | null;
  mySlot: 1 | 2;
  roundResult: RoundEndedPayload | null;
  onGuess: (guessId: string) => void;
  disabled?: boolean;
}) {
  const remaining = useRoomClock(round?.deadline ?? null);

  // 局末（roundResult 存在且未进入下一局）展示双方完整棋盘
  const ended = Boolean(roundResult);

  return (
    <section className="px-[18px] pt-5 pb-8">
      <div className="mb-3 flex items-center justify-between gap-3 rounded-[6px] border border-line bg-paper px-4 py-2.5 shadow-sm">
        <span className="rounded bg-vermilion-soft px-2 py-0.5 text-[0.72rem] font-black text-vermilion">
          {ROOM_FORMAT_SHORT[format as keyof typeof ROOM_FORMAT_SHORT] ?? format}
        </span>
        <span className="text-[0.95rem] font-black tabular-nums">
          {match.scoreSlot1} : {match.scoreSlot2}
        </span>
        <span className="text-[0.75rem] text-ink-soft">
          第 {match.roundIndex} 局{match.targetWins > 1 ? ` · 先胜 ${match.targetWins} 局` : ""}
        </span>
        {round && !ended && (
          <span className="text-[0.72rem] text-ink-soft tabular-nums">
            剩余 {formatRemaining(remaining)}
          </span>
        )}
      </div>

      <div className="grid gap-3">
        {ended && roundResult ? (
          <EndedBoards roundResult={roundResult} mySlot={mySlot} />
        ) : (
          <>
            <SelfBoard
              guesses={round?.self.guesses ?? []}
              playing={round?.status === "playing"}
              onGuess={onGuess}
              disabled={disabled}
            />
            <OpponentBoard rows={round?.opponent.rows ?? []} />
          </>
        )}
      </div>
    </section>
  );
}

// EndedBoards 局末双方完整棋盘（答案已公开，历史猜测不再敏感，08 §4.5）。
function EndedBoards({
  roundResult,
  mySlot,
}: {
  roundResult: RoundEndedPayload;
  mySlot: 1 | 2;
}) {
  const selfBoard = mySlot === 1 ? roundResult.boards.slot1 : roundResult.boards.slot2;
  const opponentBoard = mySlot === 1 ? roundResult.boards.slot2 : roundResult.boards.slot1;
  return (
    <div className="grid gap-3">
      <div className="rounded-[6px] border border-line bg-paper p-4 shadow-sm">
        <h3 className="mb-2 text-[0.8rem] font-bold text-ink-soft">我</h3>
        <div className="grid gap-2">
          {selfBoard.length === 0 && (
            <p className="m-0 py-2 text-center text-[0.8rem] text-ink-soft">本局未猜测。</p>
          )}
          {selfBoard.map((guess) => (
            <div key={guess.guessId} className="rounded-[6px] border border-line bg-paper-muted p-2.5">
              <div className="mb-1.5 flex items-center gap-2">
                <CharacterAvatarCompat name={guess.guessName} />
                <span className="text-[0.82rem] font-semibold">{guess.guessName}</span>
                {guess.isCorrect && (
                  <span className="rounded bg-jade-soft px-1.5 py-0.5 text-[0.68rem] font-bold text-jade">命中</span>
                )}
              </div>
              <div className="grid grid-cols-6 gap-1 max-[680px]:grid-cols-3">
                {guess.feedback.map((field) => (
                  <div key={field.field} className={`feedback feedback-${field.status}`} title={`${field.label}：${field.displayValue.join("、")}`}>
                    <span className="feedback-field">{field.label}</span>
                    <span className="feedback-value">
                      {field.symbol} {field.displayValue.join("、")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-[6px] border border-line bg-paper p-4 shadow-sm">
        <h3 className="mb-2 text-[0.8rem] font-bold text-ink-soft">对手（局末揭示）</h3>
        <div className="grid gap-2">
          {opponentBoard.length === 0 && (
            <p className="m-0 py-2 text-center text-[0.8rem] text-ink-soft">对手本局未猜测。</p>
          )}
          {opponentBoard.map((guess) => (
            <div key={guess.guessId} className="rounded-[6px] border border-line bg-paper-muted p-2.5">
              <div className="mb-1.5 flex items-center gap-2">
                <CharacterAvatarCompat name={guess.guessName} />
                <span className="text-[0.82rem] font-semibold">{guess.guessName}</span>
              </div>
              <div className="grid grid-cols-6 gap-1 max-[680px]:grid-cols-3">
                {guess.feedback.map((field) => (
                  <div key={field.field} className={`feedback feedback-${field.status}`} title={`${field.label}：${field.displayValue.join("、")}`}>
                    <span className="feedback-field">{field.label}</span>
                    <span className="feedback-value">
                      {field.symbol} {field.displayValue.join("、")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CharacterAvatarCompat({ name }: { name: string }) {
  // 局末揭示棋盘的头像展示（复用全局 CharacterAvatar 的视觉，无网络头像时用首字）。
  return (
    <span className="inline-flex size-[22px] items-center justify-center overflow-hidden rounded-[4px] bg-[#e7edeb] text-white font-black text-[0.7rem]" aria-hidden="true">
      {name.slice(0, 1)}
    </span>
  );
}
