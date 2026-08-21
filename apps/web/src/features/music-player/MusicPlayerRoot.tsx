"use client";

import type { ReactNode } from "react";
import type { MusicPlayerInitialPreferences } from "./contracts";
import { MusicPlayerProvider } from "./MusicPlayerProvider";

/** Stable root-layout host. It must not be keyed by a route or page state. */
export function MusicPlayerRoot({
  children,
  initialPreferences,
}: {
  children?: ReactNode;
  initialPreferences?: MusicPlayerInitialPreferences;
}) {
  return (
    <MusicPlayerProvider initialPreferences={initialPreferences}>
      {children}
    </MusicPlayerProvider>
  );
}
