"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import {
  CharacterSearchRouter,
  type SearchRouterOptions,
} from "./router";

const CharacterSearchContext = createContext<CharacterSearchRouter | null>(null);

export function CharacterSearchProvider({
  children,
  ...options
}: SearchRouterOptions & { children: React.ReactNode }) {
  const routerRef = useRef<CharacterSearchRouter | null>(null);
  if (!routerRef.current) routerRef.current = new CharacterSearchRouter(options);
  useEffect(() => () => routerRef.current?.dispose(), []);
  return (
    <CharacterSearchContext.Provider value={routerRef.current}>
      {children}
    </CharacterSearchContext.Provider>
  );
}

export function useCharacterSearchRouter(): CharacterSearchRouter | null {
  return useContext(CharacterSearchContext);
}
