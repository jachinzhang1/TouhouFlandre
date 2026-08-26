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

    const updateHeight = () => {
      setControlsHeight(
        Math.ceil(controlsElement.getBoundingClientRect().height),
      );
    };

    updateHeight();
    window.addEventListener("resize", updateHeight);
    if (typeof ResizeObserver === "undefined") {
      return () => window.removeEventListener("resize", updateHeight);
    }

    const observer = new ResizeObserver(updateHeight);
    observer.observe(controlsElement);
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
            style={{ height: controlsHeight }}
          />
          <div
            ref={setControlsElement}
            className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col border-t border-line bg-paper/95 backdrop-blur max-[680px]:bottom-[68px]"
            data-multiplayer-bottom-dock
          >
            {hasPersistentDock ? (
              <div
                className={`pointer-events-auto relative z-20 px-[18px] pt-2 ${
                  actionCount > 0 ? "pb-0" : "pb-2"
                }`}
                data-multiplayer-persistent-dock
              >
                <div className="mx-auto w-full max-w-[560px]">
                  {persistentDock}
                </div>
              </div>
            ) : null}
            <div
              ref={setActionTarget}
              className="pointer-events-auto relative z-30 empty:hidden"
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
