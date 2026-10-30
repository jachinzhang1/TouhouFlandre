"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

interface MultiplayerBottomDockContextValue {
  actionTarget: HTMLDivElement | null;
  registerAction: () => () => void;
}

const MultiplayerBottomDockContext =
  createContext<MultiplayerBottomDockContextValue | null>(null);

export function MultiplayerBottomDockProvider({
  children,
  persistentDock,
}: {
  children: ReactNode;
  persistentDock?: ReactNode;
}) {
  const [controlsElement, setControlsElement] = useState<HTMLDivElement | null>(
    null,
  );
  const [actionTarget, setActionTarget] = useState<HTMLDivElement | null>(null);
  const [actionCount, setActionCount] = useState(0);
  const [controlsHeight, setControlsHeight] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);
  const hasPersistentDock = Boolean(persistentDock);
  const hasDockContent = hasPersistentDock || actionCount > 0;

  const registerAction = useCallback(() => {
    setActionCount((current) => current + 1);
    return () => setActionCount((current) => Math.max(0, current - 1));
  }, []);

  useEffect(() => {
    if (!controlsElement) {
      setControlsHeight(0);
      return;
    }

    const footer = document.querySelector(".site-footer");
    const updateHeight = () => {
      setControlsHeight(
        Math.ceil(controlsElement.getBoundingClientRect().height),
      );
      setFooterHeight(Math.ceil(footer?.getBoundingClientRect().height ?? 0));
    };

    updateHeight();
    window.addEventListener("resize", updateHeight);
    if (typeof ResizeObserver === "undefined") {
      return () => window.removeEventListener("resize", updateHeight);
    }

    const observer = new ResizeObserver(updateHeight);
    observer.observe(controlsElement);
    if (footer) observer.observe(footer);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [controlsElement]);

  const contextValue = useMemo(
    () => ({ actionTarget, registerAction }),
    [actionTarget, registerAction],
  );

  return (
    <MultiplayerBottomDockContext.Provider value={contextValue}>
      {children}
      {hasDockContent ? (
        <>
          <div
            aria-hidden="true"
            data-multiplayer-bottom-dock-spacer
            style={{ height: controlsHeight + footerHeight }}
          />
          <div
            ref={setControlsElement}
            className="pointer-events-none fixed inset-x-0 z-45 grid gap-2 bg-[linear-gradient(to_bottom,transparent,var(--page-background)_18px)] px-[max(18px,calc((100%_-_var(--site-content-max))_/_2))] pt-[18px] pb-[calc(12px_+_env(safe-area-inset-bottom,0px))] max-[680px]:gap-1.5 max-[680px]:px-3.5 max-[680px]:pt-3.5 max-[680px]:pb-[calc(8px_+_env(safe-area-inset-bottom,0px))]"
            style={{ bottom: footerHeight }}
            data-multiplayer-bottom-dock
          >
            {hasPersistentDock ? (
              <div
                className="pointer-events-auto relative z-20 w-full min-w-0 max-w-[520px] justify-self-center"
                data-multiplayer-persistent-dock
              >
                {persistentDock}
              </div>
            ) : null}
            <div
              ref={setActionTarget}
              className="pointer-events-auto relative z-30 w-full min-w-0 max-w-[var(--site-content-max)] justify-self-center empty:hidden"
              data-multiplayer-action-dock
            />
          </div>
        </>
      ) : null}
    </MultiplayerBottomDockContext.Provider>
  );
}

export function MultiplayerBottomDockAction({
  children,
}: {
  children: ReactNode;
}) {
  const dock = useContext(MultiplayerBottomDockContext);
  const registerAction = dock?.registerAction;
  useEffect(() => registerAction?.(), [registerAction]);
  if (!dock) return children;
  if (!dock.actionTarget) return null;
  return createPortal(children, dock.actionTarget);
}
