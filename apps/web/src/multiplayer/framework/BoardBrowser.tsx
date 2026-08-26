"use client";

import { ChevronLeft, ChevronRight, History, RotateCcw } from "lucide-react";
import type { BoardBrowserModel } from "./types";

export function BoardBrowser({
  model,
  onScopeChange,
  onBoardChange,
}: {
  model: BoardBrowserModel;
  onScopeChange: (id: string) => void;
  onBoardChange?: (id: string) => void;
}) {
  const boards = model.boardOptions ?? [];
  const boardIndex = Math.max(
    0,
    boards.findIndex((board) => board.id === model.selectedBoardId),
  );
  const move = (delta: number) => {
    const target = boards[boardIndex + delta];
    if (target && !target.disabled) onBoardChange?.(target.id);
  };

  return (
    <nav
      className="mb-3 flex min-w-0 flex-wrap items-center gap-2 border-y border-line bg-paper-muted px-3 py-2"
      aria-label={model.ariaLabel}
      data-board-browser
    >
      <button
        type="button"
        onClick={() => onScopeChange(model.currentScopeId)}
        aria-pressed={model.selectedScopeId === model.currentScopeId}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-[5px] border border-line bg-paper px-2.5 text-[0.72rem] font-bold"
      >
        <RotateCcw size={14} aria-hidden="true" />
        {model.returnLabel}
      </button>
      <label className="inline-flex min-w-0 items-center gap-1.5 text-[0.72rem] font-bold text-ink-soft">
        <History size={14} aria-hidden="true" />
        <span className="sr-only">{model.scopeLabel}</span>
        <select
          aria-label={model.scopeLabel}
          value={model.selectedScopeId}
          onChange={(event) => onScopeChange(event.target.value)}
          className="min-h-8 max-w-40 rounded-[5px] border border-line bg-paper px-2 text-ink"
        >
          {model.scopeOptions.map((scope) => (
            <option key={scope.id} value={scope.id} disabled={scope.disabled}>
              {scope.label}
            </option>
          ))}
        </select>
      </label>
      {model.boardLabel ? (
        <label className="min-w-0 flex-1 text-[0.72rem] font-bold text-ink-soft max-[680px]:order-last max-[680px]:basis-full">
          <span className="sr-only">{model.boardLabel}</span>
          <select
            aria-label={model.boardLabel}
            value={model.selectedBoardId ?? ""}
            disabled={boards.length === 0}
            onChange={(event) => onBoardChange?.(event.target.value)}
            className="min-h-8 w-full min-w-0 rounded-[5px] border border-line bg-paper px-2 text-ink"
          >
            {boards.map((board) => (
              <option key={board.id} value={board.id} disabled={board.disabled}>
                {board.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {model.boardLabel ? (
        <>
          <span className="min-w-16 text-center text-[0.72rem] text-ink-soft tabular-nums max-[680px]:min-w-10">
            {boards.length ? boardIndex + 1 : 0}/{boards.length}
          </span>
          <button
            type="button"
            title="上一张棋盘"
            aria-label="上一张棋盘"
            disabled={boardIndex <= 0 || boards.length === 0}
            onClick={() => move(-1)}
            className="inline-flex size-8 items-center justify-center rounded-[5px] border border-line bg-paper disabled:opacity-40"
          >
            <ChevronLeft size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            title="下一张棋盘"
            aria-label="下一张棋盘"
            disabled={boardIndex >= boards.length - 1}
            onClick={() => move(1)}
            className="inline-flex size-8 items-center justify-center rounded-[5px] border border-line bg-paper disabled:opacity-40"
          >
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        </>
      ) : null}
      {model.trailing}
    </nav>
  );
}
