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
      className="multiplayer-match-page px-[18px] pt-4 pb-4"
      data-multiplayer-match-frame
      data-has-bottom-dock={bottomDock ? "true" : "false"}
      data-testid={testId}
    >
      <div className="multiplayer-race-shell mx-auto max-w-[1280px]">
        {children}
      </div>
      {bottomDock ? (
        <MultiplayerBottomDockAction>{bottomDock}</MultiplayerBottomDockAction>
      ) : null}
    </section>
  );
}
