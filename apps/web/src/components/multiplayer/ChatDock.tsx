"use client";

import { History, RefreshCw, Send, Smile } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { components } from "../../generated/api";
import {
  CHAT_EMOJI_WHITELIST,
  isOwnChatEntry,
  type RoomChatEntry,
  type RoomChatState,
} from "../../domain/multiChat";
import {
  Paper,
  PaperButton,
  PaperSegmentButton,
  PaperSegmentGroup,
  PaperSegmentSeparator,
  PaperTextInput,
} from "@/components/paper";

type ParticipantView = components["schemas"]["ParticipantView"];

interface ChatDockProps {
  roomId: string;
  viewer: ParticipantView | null;
  chat: RoomChatState;
  disabled?: boolean;
  placement?: "inline" | "fixed" | "deck";
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
  placement = "fixed",
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

  const sendDraft = async () => {
    if (!canSend) return;
    const queued = await onSend(draft);
    if (queued) {
      setDraft("");
      setEmojiOpen(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await sendDraft();
  };

  const insertEmoji = (emoji: string) => {
    if (inputDisabled) return;
    setDraft((current) => `${current}${emoji}`);
    inputRef.current?.focus();
  };

  const toggleReceiveChat = () => {
    setReceiveChatPreference({ storageKey, value: !receiveChat });
    onClearError();
  };

  const placementClass =
    placement === "inline"
      ? "chat-dock-inline"
      : placement === "deck"
        ? "chat-dock-deck"
        : "chat-dock-fixed";

  return (
    <div className={`chat-dock ${placementClass}`}>
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

      <Paper
        animateOnMount={false}
        ariaHidden={!historyVisible}
        as="div"
        className={`chat-dock-history-paper ${
          historyVisible
            ? "pointer-events-auto mb-2 h-72 translate-y-0 opacity-100"
            : "pointer-events-none mb-0 h-0 translate-y-2 opacity-0"
        }`}
        elevation="lg"
        folded={false}
        pattern={false}
        sticker={false}
        unfoldOnHover={false}
        variant="plain"
      >
        {historyVisible ? (
          <div
            ref={historyRef}
            className="chat-dock-history-log"
            role="log"
            aria-live="polite"
          >
            {chat.hasMoreOlder && chat.beforeCursor ? (
              <PaperButton
                className="mb-2 w-full"
                compact
                disabled={chat.loadingOlder}
                folded={false}
                onClick={onLoadOlder}
              >
                {chat.loadingOlder ? (
                  <RefreshCw size={14} className="spin" aria-hidden="true" />
                ) : null}
                加载更早
              </PaperButton>
            ) : null}
            <ChatStatus chat={chat} />
            {visibleMessages.length === 0 && chat.historyStatus === "ready" ? (
              <p className="py-10 text-center text-[0.78rem] text-ink-soft">
                暂无聊天记录
              </p>
            ) : (
              <ul className="chat-dock-history-list paper-data-table-body">
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
      </Paper>

      <form
        aria-label="房间聊天"
        onSubmit={handleSubmit}
        className="chat-dock-form"
      >
        <PaperButton
          ariaLabel="展开聊天记录"
          ariaPressed={historyOpen}
          className="chat-dock-standalone-button"
          disabled={historyDisabled}
          folded={false}
          iconOnly
          onClick={() => setHistoryOpen((current) => !current)}
          title="聊天记录"
        >
          <History size={18} aria-hidden="true" />
        </PaperButton>

        <PaperSegmentGroup
          className="chat-dock-composer-group"
          label="消息编辑"
        >
          <div className="chat-dock-input-shell">
            <PaperTextInput
              ariaLabel="聊天输入"
              className="chat-dock-input-segment chat-dock-text-control"
              disabled={inputDisabled}
              folded={false}
              inputClassName="chat-dock-input"
              inputRef={inputRef}
              maxLength={1024}
              onChange={(event) => {
                setDraft(event.target.value);
                if (chat.sendError) onClearError();
              }}
              placeholder="请输入消息"
              value={draft}
            />
          </div>

          <PaperSegmentSeparator />

          <PaperButton
            ariaLabel="选择表情"
            ariaPressed={emojiOpen}
            className="chat-dock-composer-button"
            disabled={inputDisabled}
            folded={false}
            iconOnly
            onClick={() => setEmojiOpen((current) => !current)}
            title="表情"
          >
            <Smile size={18} aria-hidden="true" />
          </PaperButton>

          <PaperSegmentSeparator />

          <PaperButton
            ariaLabel="发送消息"
            className="chat-dock-composer-button"
            disabled={!canSend}
            filled
            folded
            iconOnly
            onClick={() => void sendDraft()}
            title="发送"
          >
            <Send size={18} aria-hidden="true" />
          </PaperButton>
        </PaperSegmentGroup>

        <PaperButton
          ariaLabel={muted ? "开启聊天" : "关闭聊天"}
          ariaPressed={!muted}
          className="chat-dock-standalone-button"
          disabled={disabled || !viewer}
          folded={false}
          iconOnly
          onClick={toggleReceiveChat}
          title={muted ? "开启聊天" : "关闭聊天"}
        >
          {muted ? <MessageCircleOffIcon /> : <MessageCircleCheckIcon />}
        </PaperButton>

        {emojiOpen && !inputDisabled ? (
          <Paper
            animateOnMount={false}
            as="div"
            className="chat-dock-emoji-menu"
            elevation="lg"
            folded={false}
            sticker={false}
            pattern={false}
            unfoldOnHover={false}
          >
            {CHAT_EMOJI_WHITELIST.map((emoji) => (
              <PaperButton
                ariaLabel={`插入表情 ${emoji}`}
                className="chat-dock-emoji-option"
                compact
                folded={false}
                iconOnly
                key={emoji}
                onClick={() => insertEmoji(emoji)}
              >
                {emoji}
              </PaperButton>
            ))}
          </Paper>
        ) : null}
      </form>

      {chat.sendError ? (
        <p className="mt-1 pl-14 text-[0.72rem] font-semibold text-vermilion">
          {chat.sendError}
        </p>
      ) : null}
    </div>
  );
}

function MessageCircleCheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="lucide lucide-message-circle-check"
      fill="none"
      focusable="false"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="18"
    >
      <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function MessageCircleOffIcon() {
  return (
    <svg
      aria-hidden="true"
      className="lucide lucide-message-circle-off"
      fill="none"
      focusable="false"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="18"
    >
      <path d="m2 2 20 20" />
      <path d="M4.93 4.929a10 10 0 0 0-1.938 11.412 2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 0 0 11.302-1.989" />
      <path d="M8.35 2.69A10 10 0 0 1 21.3 15.65" />
    </svg>
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
      className={`paper-data-table-row text-[0.82rem] leading-5 ${
        failed ? "text-vermilion" : "text-ink"
      }`}
    >
      <div>
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
              <PaperButton
                className="shrink-0"
                compact
                folded={false}
                onClick={() => void onRetry(entry.clientMessageId!)}
                tone="danger"
              >
                重试
              </PaperButton>
            ) : null}
          </div>
        ) : null}
      </div>
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
      className={`pointer-events-auto ${
        leaving
          ? "opacity-0 transition-opacity duration-300"
          : "animate-[row-enter_180ms_ease-out_both]"
      }`}
      onMouseEnter={pauseTimer}
      onMouseLeave={startTimer}
    >
      <Paper
        animateOnMount={false}
        as="div"
        elevation="lg"
        className="px-3 py-2 text-[0.82rem] leading-5"
        folded={false}
        pattern={false}
        role="status"
        sticker={false}
        unfoldOnHover={false}
      >
        <ChatMessageLine entry={entry} viewerMemberId={viewerMemberId} />
      </Paper>
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
  const senderName = entry.senderDisplayName || "匿名玩家";
  const seatLabel =
    entry.senderRole === "player" && typeof entry.senderSeat === "number"
      ? `P${entry.senderSeat}`
      : null;
  return (
    <p className="m-0 break-words">
      <strong className={own ? "text-vermilion" : undefined}>
        {senderName}
      </strong>
      {seatLabel ? (
        <span className="chat-player-seat-tag">{seatLabel}</span>
      ) : null}
      <span aria-hidden="true">:</span> {entry.content}
    </p>
  );
}
