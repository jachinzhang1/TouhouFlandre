"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import { CharacterSearchRouter, type SearchRouterOptions } from "./router";

const CharacterSearchContext = createContext<CharacterSearchRouter | null>(
  null,
);

export function CharacterSearchProvider({
  children,
  ...options
}: SearchRouterOptions & { children: React.ReactNode }) {
  const routerRef = useRef<CharacterSearchRouter | null>(null);
  const disposeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (!routerRef.current)
    routerRef.current = new CharacterSearchRouter(options);
  useEffect(() => {
    // React Strict Effects runs cleanup/setup once during development. Delay
    // disposal by a tick so that probe cleanup does not poison the shared router.
    if (disposeTimerRef.current !== null) {
      clearTimeout(disposeTimerRef.current);
      disposeTimerRef.current = null;
    }
    return () => {
      const router = routerRef.current;
      disposeTimerRef.current = setTimeout(() => {
        router?.dispose();
        disposeTimerRef.current = null;
      }, 0);
    };
  }, []);
  return (
    <CharacterSearchContext.Provider value={routerRef.current}>
      {children}
    </CharacterSearchContext.Provider>
  );
}

export function useCharacterSearchRouter(): CharacterSearchRouter | null {
  return useContext(CharacterSearchContext);
}
