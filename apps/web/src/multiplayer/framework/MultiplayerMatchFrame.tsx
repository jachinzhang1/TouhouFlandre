"use client";

import type { ReactNode } from "react";

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
      className="px-[18px] pt-4 pb-28"
      data-multiplayer-match-frame
      data-testid={testId}
    >
      <div className="mx-auto max-w-[1280px]">{children}</div>
      {bottomDock}
    </section>
  );
}
