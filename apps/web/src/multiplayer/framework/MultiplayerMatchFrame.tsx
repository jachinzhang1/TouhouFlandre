"use client";

import type { ReactNode } from "react";

export function MultiplayerMatchFrame({
  children,
  bottomDock,
  summary,
  navigation,
  chat,
  mode = "race",
  testId,
}: {
  children: ReactNode;
  bottomDock?: ReactNode;
  summary?: ReactNode;
  navigation?: ReactNode;
  chat?: ReactNode;
  mode?: "race" | "relay";
  testId?: string;
}) {
  return (
    <div className={`multiplayer-game-layout multiplayer-game-layout--${mode}`}>
      {navigation}
      <section
        className={`multiplayer-match-page ${mode === "race" ? "multiplayer-race-shell" : "relay-original-page"}`}
        data-multiplayer-match-frame
        data-testid={testId}
      >
        {children}
        {bottomDock}
        {summary}
        {chat}
      </section>
    </div>
  );
}
