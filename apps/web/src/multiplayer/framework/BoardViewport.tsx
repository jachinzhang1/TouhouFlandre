"use client";

import type { ReactNode } from "react";

type BoardViewportState =
  | { status: "ready"; content: ReactNode }
  | { status: "loading"; message?: string }
  | { status: "empty"; message: string }
  | { status: "error"; message: string; onRetry?: () => void };

export function BoardViewport({ state }: { state: BoardViewportState }) {
  if (state.status === "ready") return state.content;
  if (state.status === "loading") {
    return (
      <div
        className="min-h-[360px] py-20 text-center text-ink-soft"
        role="status"
      >
        {state.message ?? "棋盘加载中……"}
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="min-h-[260px] py-16 text-center" role="alert">
        <p className="text-vermilion">{state.message}</p>
        {state.onRetry ? (
          <button
            type="button"
            className="rounded-[5px] border border-line-strong px-3 py-1.5 font-bold"
            onClick={state.onRetry}
          >
            重试
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div
      className="min-h-[260px] py-16 text-center text-ink-soft"
      role="status"
    >
      {state.message}
    </div>
  );
}
