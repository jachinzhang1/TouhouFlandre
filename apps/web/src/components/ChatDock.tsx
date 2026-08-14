"use client";

import { History, Mic, MicOff, RefreshCw, Smile } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { components } from "../generated/api";
import {
  CHAT_EMOJI_WHITELIST,
  chatSenderLabel,
  isOwnChatEntry,
  type RoomChatEntry,
  type RoomChatState,
} from "../domain/multiChat";

type ParticipantView = components["schemas"]["ParticipantView"];

interface ChatDockProps {
  roomId: string;
  viewer: ParticipantView | null;
  chat: RoomChatState;
  disabled?: boolean;
  sendEnabled?: boolean;
  onSend: (draft: string) => Promise<boolean>;
  onRetry: (clientMessageId: string) => Promise<void>;
  onLoadOlder: () => Promise<void>;
  onClearError: () => void;
}

interface ChatToast {
  id: string;
  entry: RoomChatEntry;
}

export function ChatDock({
  roomId,
  viewer,
  chat,
  disabled = false,
  sendEnabled = true,
  onSend,
  onRetry,
  onLoadOlder,
  onClearError,
}: ChatDockProps) {
  const storageKey = `touhouflandre:multi:receive-chat:${roomId}:${viewer?.memberId ?? "anonymous"}`;
  const [draft, setDraft] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [receiveChatPreference, setReceiveChatPreference] = useState({
    storageKey: "",
    value: true,
  });
  const [toasts, setToasts] = useState<ChatToast[]>([]);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previousVisibleIdsRef = useRef<Set<string>>(new Set());
  const notificationsReadyRef = useRef(false);
  const receiveChat =
    receiveChatPreference.storageKey === storageKey
      ? receiveChatPreference.value
      : true;

  useEffect(() => {
    let value = true;
    try {
      value = window.localStorage.getItem(storageKey) !== "false";
    } catch {
      value = true;
    }
    setReceiveChatPreference({ storageKey, value });
  }, [storageKey]);

  useEffect(() => {
    if (receiveChatPreference.storageKey !== storageKey) return;
    try {
      window.localStorage.setItem(storageKey, receiveChat ? "true" : "false");
    } catch {
      // localStorage is a preference cache only; failed persistence is harmless.
    }
  }, [storageKey, receiveChat, receiveChatPreference.storageKey]);

  useEffect(() => {
    setDraft("");
    setHistoryOpen(false);
    setEmojiOpen(false);
    setToasts([]);
    previousVisibleIdsRef.current = new Set();
    notificationsReadyRef.current = false;
  }, [roomId, viewer?.memberId]);

  useEffect(() => {
    if (receiveChat) return;
    setHistoryOpen(false);
    setEmojiOpen(false);
    setToasts([]);
  }, [receiveChat]);

  const visibleMessages = useMemo(() => {
    if (receiveChat) return chat.messages;
    return chat.messages.filter((entry) =>
      isOwnChatEntry(entry, viewer?.memberId),
    );
  }, [chat.messages, receiveChat, viewer?.memberId]);

  const sentVisibleMessages = useMemo(
    () => visibleMessages.filter((entry) => entry.deliveryStatus === "sent"),
    [visibleMessages],
  );

  const allSentMessages = useMemo(
    () => chat.messages.filter((entry) => entry.deliveryStatus === "sent"),
    [chat.messages],
  );

  useEffect(() => {
    const notificationBaseline = receiveChat
      ? sentVisibleMessages
      : allSentMessages;
    const currentIds = new Set(
      notificationBaseline.map((entry) => entry.messageId),
    );
    if (!notificationsReadyRef.current) {
      notificationsReadyRef.current = true;
      previousVisibleIdsRef.current = currentIds;
      return;
    }
    const newEntries = receiveChat
      ? sentVisibleMessages.filter(
          (entry) => !previousVisibleIdsRef.current.has(entry.messageId),
        )
      : [];
    previousVisibleIdsRef.current = currentIds;
    if (!receiveChat || historyOpen || newEntries.length === 0) return;
    setToasts((current) => {
      const next = [
        ...current,
        ...newEntries.map((entry) => ({ id: entry.messageId, entry })),
      ];
      return next.slice(-3);
    });
  }, [allSentMessages, historyOpen, receiveChat, sentVisibleMessages]);

  const historyVisible = historyOpen && receiveChat;

  useEffect(() => {
    if (!historyVisible) return;
    const history = historyRef.current;
    if (!history) return;
    if (typeof history.scrollTo === "function") {
      history.scrollTo({
        top: history.scrollHeight,
        behavior: "smooth",
      });
      return;
    }
    history.scrollTop = history.scrollHeight;
  }, [historyVisible, visibleMessages.length]);

  const muted = !receiveChat;
  const historyDisabled = disabled || muted || !viewer;
  const inputDisabled =
    historyDisabled || viewer?.status !== "connected" || !sendEnabled;
  const canSend = !inputDisabled && draft.trim().length > 0;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSend) return;
    const queued = await onSend(draft);
    if (queued) {
      setDraft("");
      setEmojiOpen(false);
    }
  };

  const insertEmoji = (emoji: string) => {
    if (inputDisabled) return;
    setDraft((current) => `${current}${emoji}`);
    inputRef.current?.focus();
  };

  const toggleReceiveChat = () => {
    setReceiveChatPreference((current) => ({
      storageKey,
      value: current.storageKey === storageKey ? !current.value : false,
    }));
    onClearError();
  };

  return (
    <div className="fixed bottom-24 left-4 z-[45] w-[min(420px,calc(100vw-32px))] max-[680px]:bottom-[144px]">
      <div className="pointer-events-none absolute right-12 bottom-full left-10 mb-2 flex flex-col gap-2">
        {toasts.map((toast) => (
          <ChatToastCard
            key={toast.id}
            entry={toast.entry}
            viewerMemberId={viewer?.memberId}
            onDismiss={() =>
              setToasts((current) =>
                current.filter((item) => item.id !== toast.id),
              )
            }
          />
        ))}
      </div>

      <div
        className={`overflow-hidden rounded-[6px] border bg-paper shadow-lg transition-[height,opacity,transform,border-color,margin] duration-200 ease-out ${
          historyVisible
            ? "pointer-events-auto mb-2 h-72 translate-y-0 border-line opacity-100"
            : "pointer-events-none mb-0 h-0 translate-y-2 border-transparent opacity-0"
        }`}
        aria-hidden={!historyVisible}
      >
        {historyVisible ? (
          <div
            ref={historyRef}
            className="h-full overflow-y-auto px-3 py-2"
            role="log"
            aria-live="polite"
          >
            {chat.hasMoreOlder && chat.beforeCursor ? (
              <button
                type="button"
                onClick={onLoadOlder}
                disabled={chat.loadingOlder}
                className="mb-2 flex min-h-8 w-full items-center justify-center gap-2 rounded-[5px] border border-line bg-paper-muted px-3 text-[0.75rem] font-bold text-ink-soft hover:bg-paper disabled:cursor-not-allowed disabled:opacity-60"
              >
                {chat.loadingOlder ? (
                  <RefreshCw size={14} className="spin" aria-hidden="true" />
                ) : null}
                加载更早
              </button>
            ) : null}
            <ChatStatus chat={chat} />
            {visibleMessages.length === 0 && chat.historyStatus === "ready" ? (
              <p className="py-10 text-center text-[0.78rem] text-ink-soft">
                暂无聊天记录
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {visibleMessages.map((entry) => (
                  <ChatHistoryMessage
                    key={entry.messageId}
                    entry={entry}
                    viewerMemberId={viewer?.memberId}
                    onRetry={onRetry}
                  />
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>

      <form
        onSubmit={handleSubmit}
        className="pointer-events-auto flex items-center gap-2"
      >
        <button
          type="button"
          aria-label="展开聊天记录"
          aria-pressed={historyOpen}
          title="聊天记录"
          onClick={() => setHistoryOpen((current) => !current)}
          disabled={historyDisabled}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-[6px] border border-line bg-paper text-ink-soft shadow-sm hover:bg-paper-muted disabled:cursor-not-allowed disabled:opacity-45"
        >
          <History size={18} aria-hidden="true" />
        </button>

        <div className="relative min-w-0 flex-1">
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              if (chat.sendError) onClearError();
            }}
            disabled={inputDisabled}
            maxLength={1024}
            aria-label="聊天输入"
            placeholder="请输入消息"
            className="h-10 w-full rounded-[6px] border border-line-strong bg-paper pr-11 pl-3 text-[0.86rem] text-ink shadow-sm outline-none focus:border-line-strong focus:shadow-none focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] disabled:cursor-not-allowed disabled:bg-paper-muted disabled:text-ink-soft"
          />
          <button
            type="button"
            aria-label="选择表情"
            title="表情"
            onClick={() => setEmojiOpen((current) => !current)}
            disabled={inputDisabled}
            className="absolute top-1/2 right-1 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-[5px] text-ink-soft hover:bg-paper-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Smile size={17} aria-hidden="true" />
          </button>
          {emojiOpen && !inputDisabled ? (
            <div className="absolute right-0 bottom-full mb-2 grid grid-cols-6 gap-1 rounded-[6px] border border-line bg-paper p-2 shadow-lg">
              {CHAT_EMOJI_WHITELIST.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insertEmoji(emoji)}
                  className="inline-flex size-8 items-center justify-center rounded-[5px] text-[1.05rem] hover:bg-paper-muted"
                >
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          aria-label={muted ? "开启聊天" : "闭麦"}
          aria-pressed={muted}
          title={muted ? "开启聊天" : "闭麦"}
          onClick={toggleReceiveChat}
          disabled={disabled || !viewer}
          className={`inline-flex size-10 shrink-0 items-center justify-center rounded-[6px] border shadow-sm disabled:cursor-not-allowed disabled:opacity-45 ${
            muted
              ? "border-vermilion bg-vermilion-soft text-vermilion"
              : "border-line bg-paper text-ink-soft hover:bg-paper-muted"
          }`}
        >
          {muted ? (
            <MicOff size={18} aria-hidden="true" />
          ) : (
            <Mic size={18} aria-hidden="true" />
          )}
        </button>
      </form>

      {chat.sendError ? (
        <p className="mt-1 pl-12 text-[0.72rem] font-semibold text-vermilion">
          {chat.sendError}
        </p>
      ) : null}
    </div>
  );
}

function ChatStatus({ chat }: { chat: RoomChatState }) {
  if (chat.historyStatus === "loading") {
    return (
      <p className="py-6 text-center text-[0.78rem] text-ink-soft">
        聊天同步中…
      </p>
    );
  }
  if (chat.historyStatus === "error" && chat.historyError) {
    return (
      <p className="py-6 text-center text-[0.78rem] font-semibold text-vermilion">
        {chat.historyError}
      </p>
    );
  }
  return null;
}

function ChatHistoryMessage({
  entry,
  viewerMemberId,
  onRetry,
}: {
  entry: RoomChatEntry;
  viewerMemberId?: string;
  onRetry: (clientMessageId: string) => Promise<void>;
}) {
  const failed = entry.deliveryStatus === "failed";
  const sending = entry.deliveryStatus === "sending";
  return (
    <li
      className={`py-1.5 text-[0.82rem] leading-5 ${
        failed ? "text-vermilion" : "text-ink"
      }`}
    >
      <ChatMessageLine entry={entry} viewerMemberId={viewerMemberId} />
      {sending ? (
        <small className="mt-1 block text-[0.7rem] font-bold text-ink-soft">
          发送中
        </small>
      ) : null}
      {failed ? (
        <div className="mt-1 flex items-center justify-between gap-2">
          <small className="min-w-0 text-[0.7rem] font-bold">
            {entry.error ?? "发送失败"}
          </small>
          {entry.clientMessageId ? (
            <button
              type="button"
              onClick={() => void onRetry(entry.clientMessageId!)}
              className="shrink-0 rounded-[5px] border border-vermilion px-2 py-0.5 text-[0.68rem] font-black"
            >
              重试
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function ChatToastCard({
  entry,
  viewerMemberId,
  onDismiss,
}: {
  entry: RoomChatEntry;
  viewerMemberId?: string;
  onDismiss: () => void;
}) {
  const [leaving, setLeaving] = useState(false);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const remainingRef = useRef(5000);

  useEffect(() => {
    startTimer();
    return () => clearTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearTimer = () => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const startTimer = () => {
    clearTimer();
    startedAtRef.current = Date.now();
    timerRef.current = window.setTimeout(() => {
      setLeaving(true);
      timerRef.current = window.setTimeout(onDismiss, 300);
    }, remainingRef.current);
  };

  const pauseTimer = () => {
    clearTimer();
    const elapsed = Date.now() - startedAtRef.current;
    remainingRef.current = Math.max(300, remainingRef.current - elapsed);
  };

  return (
    <div
      className={`pointer-events-auto rounded-[6px] border border-line bg-paper px-3 py-2 text-[0.82rem] leading-5 text-ink shadow-lg ${
        leaving
          ? "opacity-0 transition-opacity duration-300"
          : "animate-[row-enter_180ms_ease-out_both]"
      }`}
      onMouseEnter={pauseTimer}
      onMouseLeave={startTimer}
      role="status"
    >
      <ChatMessageLine entry={entry} viewerMemberId={viewerMemberId} />
    </div>
  );
}

function ChatMessageLine({
  entry,
  viewerMemberId,
}: {
  entry: RoomChatEntry;
  viewerMemberId?: string;
}) {
  const own = isOwnChatEntry(entry, viewerMemberId);
  return (
    <p className="m-0 break-words">
      <strong className={own ? "text-vermilion" : undefined}>
        {chatSenderLabel(entry)}
      </strong>{" "}
      {entry.content}
    </p>
  );
}
