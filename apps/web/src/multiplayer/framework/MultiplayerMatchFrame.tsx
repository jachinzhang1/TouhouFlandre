"use client";

import type { ReactNode } from "react";
import { MultiplayerBottomDockAction } from "./MultiplayerBottomDock";

export function MultiplayerMatchFrame({
  children,
  bottomDock,
  testId,
}: {
  children: ReactNode;
  bottomDock?: ReactNode;
  testId?: string;
}) {
  return (
    <section
      className="mx-auto w-full max-w-[var(--site-content-max)] py-[22px] max-[680px]:px-3.5 max-[680px]:py-4"
      data-multiplayer-match-frame
      data-has-bottom-dock={bottomDock ? "true" : "false"}
      data-testid={testId}
    >
      <div className="multiplayer-race-shell grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3.5 max-[680px]:gap-3">
        {children}
      </div>
      {bottomDock ? (
        <MultiplayerBottomDockAction>{bottomDock}</MultiplayerBottomDockAction>
      ) : null}
    </section>
  );
}
