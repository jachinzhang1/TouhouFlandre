"use client";

import { ChevronLeft, ChevronRight, History, RotateCcw } from "lucide-react";
import type { BoardBrowserModel } from "./types";
import { PaperButton, PaperSelect } from "../../components/paper";

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
      className="flex min-w-0 flex-wrap items-center gap-2"
      aria-label={model.ariaLabel}
      data-board-browser
    >
      <PaperButton
        compact
        onClick={() => onScopeChange(model.currentScopeId)}
        ariaPressed={model.selectedScopeId === model.currentScopeId}
        tone="theme"
        filled={model.selectedScopeId === model.currentScopeId}
      >
        <RotateCcw size={14} aria-hidden="true" />
        {model.returnLabel}
      </PaperButton>
      <label className="inline-flex min-w-0 items-center gap-1.5 text-[0.72rem] font-bold text-ink-soft">
        <History size={14} aria-hidden="true" />
        <span className="sr-only">{model.scopeLabel}</span>
        <PaperSelect
          compact
          aria-label={model.scopeLabel}
          value={model.selectedScopeId}
          onChange={(event) => onScopeChange(event.target.value)}
          className="max-w-[180px]"
        >
          {model.scopeOptions.map((scope) => (
            <option key={scope.id} value={scope.id} disabled={scope.disabled}>
              {scope.label}
            </option>
          ))}
        </PaperSelect>
      </label>
      {model.boardLabel ? (
        <label className="min-w-0 flex-1 text-[0.72rem] font-bold text-ink-soft max-[680px]:order-last max-[680px]:basis-full">
          <span className="sr-only">{model.boardLabel}</span>
          <PaperSelect
            compact
            aria-label={model.boardLabel}
            value={model.selectedBoardId ?? ""}
            disabled={boards.length === 0}
            onChange={(event) => onBoardChange?.(event.target.value)}
            className="w-full"
          >
            {boards.map((board) => (
              <option key={board.id} value={board.id} disabled={board.disabled}>
                {board.label}
              </option>
            ))}
          </PaperSelect>
        </label>
      ) : null}
      {model.boardLabel ? (
        <>
          <span className="min-w-16 text-center text-[0.72rem] text-ink-soft tabular-nums max-[680px]:min-w-10">
            {boards.length ? boardIndex + 1 : 0}/{boards.length}
          </span>
          <PaperButton
            compact
            iconOnly
            title="上一张棋盘"
            ariaLabel="上一张棋盘"
            disabled={boardIndex <= 0 || boards.length === 0}
            onClick={() => move(-1)}
          >
            <ChevronLeft size={15} aria-hidden="true" />
          </PaperButton>
          <PaperButton
            compact
            iconOnly
            title="下一张棋盘"
            ariaLabel="下一张棋盘"
            disabled={boardIndex >= boards.length - 1}
            onClick={() => move(1)}
          >
            <ChevronRight size={15} aria-hidden="true" />
          </PaperButton>
        </>
      ) : null}
      {model.trailing}
    </nav>
  );
}
