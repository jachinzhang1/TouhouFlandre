"use client";

// 多人大厅（08 §10.1）：创建房间（赛制单选 + 昵称）、加入房间（房间号 + 昵称 + 公开预检）。
import { useRouter } from "next/navigation";
import { DoorOpen, Plus, Users } from "lucide-react";
import { useState } from "react";
import type { MultiRoomFormat } from "@touhoufriberg/shared";
import type { components } from "../generated/api";

type RoomInfo = components["schemas"]["RoomInfo"];
import {
  isValidRoomCode,
  normalizeRoomCode,
  ROOM_FORMAT_LABELS,
  ROOM_FORMAT_SHORT,
  saveMultiRoom,
} from "../domain/multiRoom";
import { api } from "../lib/api";

const FORMATS: MultiRoomFormat[] = ["bo1", "bo3", "bo5", "bo7"];

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "操作失败。");

export function MultiLobby() {
  const router = useRouter();
  const [format, setFormat] = useState<MultiRoomFormat>("bo3");
  const [nickname, setNickname] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [joinNickname, setJoinNickname] = useState("");
  const [info, setInfo] = useState<RoomInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoError, setInfoError] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);

  const normalizedCode = normalizeRoomCode(joinCode);
  const codeValid = isValidRoomCode(normalizedCode);

  const precheck = async () => {
    if (!codeValid) {
      setInfo(null);
      setInfoError(false);
      return;
    }
    setInfoLoading(true);
    try {
      setInfo(await api.roomInfo(normalizedCode));
      setInfoError(false);
    } catch {
      setInfo(null);
      setInfoError(true); // 404 或限流（429）；统称未找到
    } finally {
      setInfoLoading(false);
    }
  };

  const handleCreate = async () => {
    setBusy("create");
    setError("");
    try {
      const created = await api.createRoom({
        format,
        displayName: nickname || undefined,
      });
      saveMultiRoom({
        roomId: created.roomId,
        roomCode: created.roomCode,
        guestToken: created.guestToken,
        memberSlot: created.member.slot === 2 ? 2 : 1,
      });
      router.push(`/multi/room/${created.roomCode}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };

  const handleJoin = async () => {
    setBusy("join");
    setError("");
    try {
      const joined = await api.joinRoom(normalizedCode, {
        displayName: joinNickname || undefined,
      });
      saveMultiRoom({
        roomId: joined.roomId,
        roomCode: normalizedCode,
        guestToken: joined.guestToken,
        memberSlot: joined.member.slot === 2 ? 2 : 1,
      });
      router.push(`/multi/room/${normalizedCode}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <section className="px-[18px] pt-12 pb-8">
      <div className="mx-auto max-w-[720px]">
        <p className="mt-0 mb-2 text-[0.69rem] font-black tracking-[0.12em] text-vermilion">
          MULTIPLAYER
        </p>
        <h1 className="mt-0 mb-1 font-brand text-[2.6rem] leading-[1.15] max-[680px]:text-[2.05rem]">
          多人大厅
        </h1>
        <p className="mt-0 mb-8 text-[0.9rem] leading-[1.75] text-ink-soft">
          创建房间或输入房间号加入，与好友实时竞猜同一个隐藏角色。
        </p>

        {error && (
          <p className="mb-4 rounded-[6px] border border-vermilion-soft bg-vermilion-soft px-3 py-2 text-[0.82rem] text-vermilion" role="alert">
            {error}
          </p>
        )}

        <div className="grid gap-5 md:grid-cols-2">
          <div className="rounded-[10px] border border-line bg-paper p-5 shadow-sm">
            <h2 className="mt-0 mb-1 flex items-center gap-2 text-[1rem] font-bold">
              <Plus size={17} className="text-vermilion" aria-hidden="true" />
              创建房间
            </h2>
            <p className="mt-0 mb-4 text-[0.78rem] text-ink-soft">
              你是房主，选择赛制并邀请好友加入。
            </p>
            <fieldset className="mb-4">
              <legend className="sr-only">赛制</legend>
              <div className="grid grid-cols-2 gap-2">
                {FORMATS.map((f) => (
                  <label
                    key={f}
                    className={`flex cursor-pointer items-center justify-between rounded-[6px] border px-3 py-2 text-[0.8rem] font-semibold ${
                      format === f
                        ? "border-vermilion bg-vermilion-soft text-vermilion"
                        : "border-line bg-paper-muted hover:bg-paper"
                    }`}
                  >
                    <input
                      type="radio"
                      name="format"
                      value={f}
                      checked={format === f}
                      onChange={() => setFormat(f)}
                      className="sr-only"
                    />
                    <span>{ROOM_FORMAT_SHORT[f]}</span>
                    <span className="text-[0.68rem] font-normal text-ink-soft">
                      {ROOM_FORMAT_LABELS[f].split(" · ")[1]}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="mb-4 block">
              <span className="mb-1 block text-[0.75rem] text-ink-soft">昵称（可选，≤16 字符）</span>
              <input
                value={nickname}
                maxLength={16}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="匿名玩家"
                className="w-full rounded-[6px] border border-line-strong bg-paper px-3 py-2 text-[0.85rem] outline-none focus:border-vermilion"
              />
            </label>
            <button
              type="button"
              disabled={busy !== null}
              onClick={handleCreate}
              className="flex w-full items-center justify-center gap-2 rounded-[6px] bg-vermilion px-4 py-2.5 font-bold text-white hover:bg-vermilion-dark disabled:opacity-50"
            >
              <Users size={16} aria-hidden="true" />
              {busy === "create" ? "创建中……" : "创建房间"}
            </button>
          </div>

          <div className="rounded-[10px] border border-line bg-paper p-5 shadow-sm">
            <h2 className="mt-0 mb-1 flex items-center gap-2 text-[1rem] font-bold">
              <DoorOpen size={17} className="text-jade" aria-hidden="true" />
              加入房间
            </h2>
            <p className="mt-0 mb-4 text-[0.78rem] text-ink-soft">
              输入好友分享的 6 位房间号。
            </p>
            <label className="mb-2 block">
              <span className="mb-1 block text-[0.75rem] text-ink-soft">房间号</span>
              <input
                value={joinCode}
                onChange={(e) => {
                  setJoinCode(e.target.value);
                  setInfo(null);
                  setInfoError(false);
                }}
                onBlur={precheck}
                placeholder="如 ABC123（自动忽略空格/连字符）"
                className="w-full rounded-[6px] border border-line-strong bg-paper px-3 py-2 font-mono text-[0.9rem] uppercase tracking-[0.2em] outline-none focus:border-vermilion"
                maxLength={12}
              />
            </label>
            {infoLoading && <p className="mt-0 mb-2 text-[0.72rem] text-ink-soft">查询中……</p>}
            {info && (
              <p className="mt-0 mb-2 text-[0.72rem] text-jade">
                房间存在 · {ROOM_FORMAT_LABELS[info.format as MultiRoomFormat]} · 当前 {info.memberCount}/2 人
              </p>
            )}
            {codeValid && infoError && !infoLoading && (
              <p className="mt-0 mb-2 text-[0.72rem] text-vermilion">
                未找到该房间或查询过于频繁，请稍后再试。
              </p>
            )}
            <label className="mb-4 block">
              <span className="mb-1 block text-[0.75rem] text-ink-soft">昵称（可选，≤16 字符）</span>
              <input
                value={joinNickname}
                maxLength={16}
                onChange={(e) => setJoinNickname(e.target.value)}
                placeholder="匿名玩家"
                className="w-full rounded-[6px] border border-line-strong bg-paper px-3 py-2 text-[0.85rem] outline-none focus:border-vermilion"
              />
            </label>
            <button
              type="button"
              disabled={busy !== null || !codeValid}
              onClick={handleJoin}
              className="flex w-full items-center justify-center gap-2 rounded-[6px] bg-jade px-4 py-2.5 font-bold text-white hover:bg-[#1b5a50] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <DoorOpen size={16} aria-hidden="true" />
              {busy === "join" ? "加入中……" : "加入房间"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
