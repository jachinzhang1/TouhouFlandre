"use client";

// 房间大厅（08 §10.2）：房间号大字 + 复制、成员列表与就绪态、准备/离开按钮。
import { Check, Copy, LogOut, Play } from "lucide-react";
import { useState } from "react";
import type { components } from "../generated/api";

type MemberView = components["schemas"]["MemberView"];
import {
  MULTIPLAYER_MODE_LABELS,
  ROOM_FORMAT_LABELS,
} from "../domain/multiRoom";

const MEMBER_STATUS_LABEL: Record<string, string> = {
  connected: "在线",
  disconnected: "离线",
  left: "已离开",
};

export function RoomLobby({
  roomCode,
  format,
  mode,
  turnSeconds,
  members,
  mySlot,
  onReady,
  onLeave,
}: {
  roomCode: string;
  format: string;
  mode: string;
  turnSeconds: number;
  members: MemberView[];
  mySlot: 1 | 2;
  onReady: () => void;
  onLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const mine = members.find((m) => m.slot === mySlot);
  const other = members.find((m) => m.slot !== mySlot);
  const bothReady = members.length === 2 && members.every((m) => m.ready);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用（非 https）：提示手动复制
    }
  };

  return (
    <section className="px-[18px] pt-12 pb-8">
      <div className="mx-auto max-w-[560px] rounded-[10px] border border-line bg-paper p-8 text-center shadow-sm">
        <p className="mt-0 mb-2 text-[0.72rem] font-black tracking-[0.14em] text-vermilion">
          ROOM LOBBY
        </p>
        <h1 className="mt-0 mb-1 font-brand text-[3.2rem] leading-none tracking-[0.1em]">
          {roomCode}
        </h1>
        <p className="mb-5 text-[0.8rem] text-ink-soft">
          {MULTIPLAYER_MODE_LABELS[mode as keyof typeof MULTIPLAYER_MODE_LABELS] ?? mode}
          {mode === "relay" ? ` ${turnSeconds}s` : ""} ·{" "}
          {ROOM_FORMAT_LABELS[format as keyof typeof ROOM_FORMAT_LABELS] ?? format} ·
          把房间号发给好友加入
        </p>

        <button
          type="button"
          onClick={copyCode}
          className="mb-6 inline-flex items-center gap-1.5 rounded-[6px] border border-line-strong bg-paper-muted px-3 py-1.5 text-[0.8rem] font-semibold hover:bg-paper"
        >
          {copied ? <Check size={14} className="text-jade" /> : <Copy size={14} />}
          {copied ? "已复制" : "复制房间号"}
        </button>

        <ul className="mb-6 grid gap-2 text-left">
          {members.map((member) => (
            <li
              key={member.slot}
              className="flex items-center justify-between rounded-[6px] border border-line bg-paper-muted px-3.5 py-2.5"
            >
              <span className="flex items-center gap-2">
                <span
                  className={`inline-flex size-5 items-center justify-center rounded text-[0.62rem] font-black ${
                    member.slot === 1 ? "bg-vermilion text-white" : "bg-jade text-white"
                  }`}
                >
                  {member.slot}
                </span>
                <span className="text-[0.85rem] font-semibold">
                  {member.displayName}
                  {member.slot === mySlot ? "（我）" : ""}
                </span>
              </span>
              <span className="flex items-center gap-2 text-[0.72rem] text-ink-soft">
                {member.ready ? (
                  <span className="rounded bg-jade-soft px-1.5 py-0.5 font-bold text-jade">已准备</span>
                ) : (
                  <span className="rounded bg-paper px-1.5 py-0.5">未准备</span>
                )}
                {MEMBER_STATUS_LABEL[member.status] ?? member.status}
              </span>
            </li>
          ))}
          {!other && (
            <li className="rounded-[6px] border border-dashed border-line-strong px-3.5 py-2.5 text-[0.78rem] text-ink-soft">
              等待好友加入……（房间号 {roomCode}）
            </li>
          )}
        </ul>

        <div className="grid gap-2">
          <button
            type="button"
            disabled={!other || mine?.ready}
            onClick={onReady}
            className="flex w-full items-center justify-center gap-2 rounded-[6px] bg-vermilion px-4 py-2.5 font-bold text-white hover:bg-vermilion-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play size={16} aria-hidden="true" />
            {mine?.ready ? "已准备，等待对方……" : "准备"}
          </button>
          {bothReady && (
            <p className="m-0 text-[0.75rem] text-jade" aria-live="polite">
              双方已就绪，对局即将开始……
            </p>
          )}
          <button
            type="button"
            onClick={onLeave}
            className="flex w-full items-center justify-center gap-2 rounded-[6px] border border-line-strong bg-paper px-4 py-2 font-semibold text-ink-soft hover:bg-paper-muted"
          >
            <LogOut size={15} aria-hidden="true" />
            离开房间
          </button>
        </div>
      </div>
    </section>
  );
}
