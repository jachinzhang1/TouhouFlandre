"use client";

import { useCallback, type RefCallback } from "react";

export function useActiveOptionScrollRef<
  T extends HTMLElement,
>(): RefCallback<T> {
  return useCallback((element) => {
    element?.scrollIntoView({
      behavior: "auto",
      block: "nearest",
      inline: "nearest",
    });
  }, []);
}
