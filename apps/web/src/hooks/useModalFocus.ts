"use client";

import { useEffect, useRef, type KeyboardEventHandler } from "react";

const FOCUSABLE_ELEMENT =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function useModalFocus<T extends HTMLElement>(
  onEscape?: () => void,
  active = true,
) {
  const dialogRef = useRef<T>(null);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    const initial =
      dialog?.querySelector<HTMLElement>("[data-modal-initial-focus]") ??
      dialog?.querySelector<HTMLElement>(FOCUSABLE_ELEMENT);
    initial?.focus();
    const backgroundBranches: Array<{
      element: HTMLElement;
      inert: boolean;
    }> = [];
    let activeBranch: HTMLElement | null = dialog ?? null;
    while (
      activeBranch &&
      activeBranch !== document.body &&
      activeBranch.parentElement
    ) {
      const parent: HTMLElement = activeBranch.parentElement;
      for (const child of parent.children) {
        if (child === activeBranch || !(child instanceof HTMLElement)) continue;
        backgroundBranches.push({
          element: child,
          inert: Boolean(child.inert),
        });
        child.inert = true;
      }
      activeBranch = parent;
    }

    return () => {
      for (const { element, inert } of backgroundBranches) {
        element.inert = inert;
      }
      if (previousFocus?.isConnected) previousFocus.focus();
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [active]);

  const onDialogKeyDown: KeyboardEventHandler<T> = (event) => {
    if (event.key === "Escape" && onEscapeRef.current) {
      event.preventDefault();
      event.stopPropagation();
      onEscapeRef.current();
      return;
    }
    if (event.key !== "Tab") return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(FOCUSABLE_ELEMENT),
    );
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return { dialogRef, onDialogKeyDown };
}
