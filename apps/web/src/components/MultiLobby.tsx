"use client";

// 多人大厅（08 §10.1）：创建房间（赛制单选 + 昵称）、加入房间（房间号 + 昵称 + 公开预检）。
import { useRouter } from "next/navigation";
import { DoorOpen, Eye, Plus, Settings, Users } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  MultiRoomFormat,
  MultiplayerMode,
  QuestionScopeConfig,
} from "@touhouflandre/shared";
import type { components } from "../generated/api";

type RoomInfo = components["schemas"]["RoomInfo"];
import {
  isValidRoomCode,
  MULTIPLAYER_MODE_DESCRIPTIONS,
  MULTIPLAYER_MODE_LABELS,
  normalizeRoomCode,
  ROOM_FORMAT_LABELS,
  ROOM_FORMAT_SHORT,
  raceSettingsSummary,
  saveMultiRoom,
  TURN_SECONDS_OPTIONS,
  type RelayTurnSeconds,
} from "../domain/multiRoom";
import { api } from "../lib/api";
import {
  catalogFullToSnapshot,
  loadLocalQuestionScope,
} from "../lib/questionScopeStorage";
import { isNPlayerRaceUiEnabled } from "../config/multiplayerRollout";
import { QuestionScopeDialog } from "./QuestionScopeDialog";
import { RaceEliminationSwitch } from "./RaceEliminationSwitch";

const FORMATS: MultiRoomFormat[] = ["bo1", "bo3", "bo5", "bo7"];
const MODES: MultiplayerMode[] = ["race", "relay"];
const MODE_RULES: Record<MultiplayerMode, string> = {
  race: `**竞速模式**中，2 至 8 名玩家会同时竞猜同一个隐藏角色，每局限时 **5 分钟**。出题范围和猜测次数限制**由房主决定**。己方棋盘可以看到完整的猜测记录和字段反馈，对手棋盘则只显示标签命中情况。

实际开局为 2 人时按所选总局数进行双人赛，率先猜中者赢得本局。实际开局超过 2 人时，若开启积分赛淘汰，则使用积分淘汰制：猜中越快，本局得分越高；放弃、次数耗尽或超时得 0 分。达到淘汰轮次后，每局会淘汰累计积分最低的玩家，直至决出最终排行榜。`,
  relay: `**接力模式**中，双方共用同一张棋盘并轮流行动，出题范围和猜测次数限制**由房主决定**。当前轮到的玩家可以提交一次猜测或主动选择空过。猜测、主动空过和超时空过都会计入自己的轮次。提交正确角色的一方赢得本局；若双方都用尽轮次仍无人猜中，或本局总倒计时结束，则本局判为平局。

接力房间会为每一手设置单独限时。轮到自己时若在限时内没有提交，会自动记为超时空过并轮到对方；主动空过与超时空过共享每人每局 **2 次**空过额度，额度耗尽后再次空过会导致该玩家本局判负。`,
};
const DUO_RACE_RULE = `**竞速模式**中，两名玩家会同时竞猜同一个隐藏角色，每局限时 **5 分钟**。出题范围和猜测次数限制**由房主决定**。己方棋盘可以看到完整的猜测记录和字段反馈，对手棋盘则只显示标签命中情况。

率先猜中者赢得本局，并按所选总局数决定整场胜负。`;

const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : "操作失败。";

export function MultiLobby() {
  const router = useRouter();
  const [format, setFormat] = useState<MultiRoomFormat>("bo3");
  const [mode, setMode] = useState<MultiplayerMode>("race");
  const [turnSeconds, setTurnSeconds] = useState<RelayTurnSeconds>(60);
  const [playerLimit, setPlayerLimit] = useState(2);
  const [raceEliminationEnabled, setRaceEliminationEnabled] = useState(false);
  const [nickname, setNickname] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [joinNickname, setJoinNickname] = useState("");
  const [info, setInfo] = useState<RoomInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoError, setInfoError] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [hostScopeOpen, setHostScopeOpen] = useState(false);
  const nPlayerRaceEnabled = isNPlayerRaceUiEnabled();

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
      const questionScope = loadLocalQuestionScope(
        catalogFullToSnapshot(await api.catalogFull()),
      ).config;
      const created = await api.createRoom({
        format,
        mode,
        ...(mode === "race" && nPlayerRaceEnabled ? { playerLimit } : {}),
        ...(mode === "race"
          ? {
              raceEliminationEnabled:
                playerLimit >= 3 && raceEliminationEnabled,
            }
          : {}),
        turnSeconds,
        displayName: nickname || undefined,
        questionScope,
      });
      saveMultiRoom({
        roomId: created.roomId,
        roomCode: created.roomCode,
        guestToken: created.guestToken,
        role: created.viewer.role,
        memberId: created.viewer.memberId,
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
        role: joined.viewer.role,
        memberId: joined.viewer.memberId,
      });
      router.push(`/multi/room/${normalizedCode}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <section className="px-[18px] pt-12 pb-8">
      <div className="max-w-[1000px]">
        <div className="max-w-[720px]">
          <p className="mt-0 mb-2 text-[0.69rem] font-black tracking-[0.12em] text-vermilion">
            MULTIPLAYER
          </p>
          <h1 className="mt-0 mb-1 font-brand text-[2.6rem] font-bold leading-[1.15] max-[680px]:text-[2.05rem]">
            多人大厅
          </h1>
          <p className="mt-0 mb-8 text-[0.9rem] leading-[1.75] text-ink-soft">
            创建房间或输入房间号加入，与好友实时竞猜同一个隐藏角色。
          </p>
        </div>

        {error && (
          <p
            className="mb-4 rounded-[6px] border border-vermilion-soft bg-vermilion-soft px-3 py-2 text-[0.82rem] text-vermilion"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="grid gap-5 md:grid-cols-2">
          <div className="flex h-full flex-col rounded-[6px] border border-line bg-paper p-5 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="mt-0 mb-1 flex items-center gap-2 text-[1rem] font-bold">
                  <Plus
                    size={17}
                    className="text-vermilion"
                    aria-hidden="true"
                  />
                  创建房间
                </h2>
                <p className="m-0 text-[0.78rem] text-ink-soft">
                  你是房主，选择玩法和赛制并邀请好友加入。
                </p>
              </div>
              <button
                type="button"
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[5px] border border-line bg-paper-muted px-2.5 text-[0.72rem] font-bold text-ink-soft hover:bg-paper"
                onClick={() => setScopeOpen(true)}
              >
                <Settings size={14} aria-hidden="true" />
                题库设置
              </button>
            </div>
            <fieldset className="mb-4">
              <legend className="mb-1 text-[0.75rem] text-ink-soft">
                玩法
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {MODES.map((option) => (
                  <label
                    key={option}
                    className={`mode-option relative flex min-h-[58px] cursor-pointer flex-col justify-center rounded-[6px] border px-3 py-2 text-[0.8rem] font-semibold ${
                      mode === option
                        ? "border-vermilion bg-vermilion-soft text-vermilion"
                        : "border-line bg-paper-muted hover:bg-paper"
                    }`}
                  >
                    <input
                      type="radio"
                      name="mode"
                      value={option}
                      checked={mode === option}
                      onChange={() => setMode(option)}
                      aria-describedby={`mode-rule-${option}`}
                      className="sr-only"
                    />
                    <span>{MULTIPLAYER_MODE_LABELS[option]}</span>
                    <span className="mt-0.5 text-[0.68rem] font-normal text-ink-soft">
                      {MULTIPLAYER_MODE_DESCRIPTIONS[option]}
                    </span>
                    <ModeRulePopover
                      mode={option}
                      nPlayerRaceEnabled={nPlayerRaceEnabled}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            {mode === "relay" && (
              <fieldset className="mb-4">
                <legend className="mb-1 text-[0.75rem] text-ink-soft">
                  单手时限
                </legend>
                <div className="grid grid-cols-4 gap-2">
                  {TURN_SECONDS_OPTIONS.map((seconds) => (
                    <label
                      key={seconds}
                      className={`flex cursor-pointer items-center justify-center rounded-[6px] border px-2 py-2 text-[0.78rem] font-bold tabular-nums ${
                        turnSeconds === seconds
                          ? "border-jade bg-jade-soft text-jade"
                          : "border-line bg-paper-muted hover:bg-paper"
                      }`}
                    >
                      <input
                        type="radio"
                        name="turnSeconds"
                        value={seconds}
                        checked={turnSeconds === seconds}
                        onChange={() => setTurnSeconds(seconds)}
                        className="sr-only"
                      />
                      {seconds}s
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {mode === "race" && nPlayerRaceEnabled ? (
              <div className="mb-4 flex items-end gap-4">
                <label
                  className="min-w-0 flex-1 text-[0.78rem] text-ink-soft"
                  htmlFor="create-player-limit"
                >
                  <span className="mb-1 flex justify-between">
                    <span>玩家上限</span>
                    <output
                      htmlFor="create-player-limit"
                      className="font-bold tabular-nums text-ink"
                    >
                      {playerLimit} 人
                    </output>
                  </span>
                  <input
                    id="create-player-limit"
                    aria-label="玩家上限（2-8）"
                    type="range"
                    min={2}
                    max={8}
                    step={1}
                    value={playerLimit}
                    onChange={(event) =>
                      setPlayerLimit(
                        Math.min(
                          8,
                          Math.max(2, Number(event.target.value) || 2),
                        ),
                      )
                    }
                    className="block w-full accent-vermilion"
                  />
                </label>
                <RaceEliminationSwitch
                  checked={raceEliminationEnabled}
                  disabled={playerLimit < 3}
                  onChange={setRaceEliminationEnabled}
                  className="shrink-0 pb-1"
                />
              </div>
            ) : null}
            <fieldset className="mb-4">
              <legend className="mb-1 text-[0.75rem] text-ink-soft">
                总局数
              </legend>
              <div className="grid grid-cols-4 gap-2">
                {FORMATS.map((f) => (
                  <label
                    key={f}
                    className={`flex min-h-[54px] cursor-pointer items-center justify-center rounded-[6px] border px-3 py-2 text-center text-[0.9rem] font-semibold ${
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
                    <span className="tracking-[0.04em]">
                      {ROOM_FORMAT_SHORT[f]}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="mb-4 text-[0.78rem] leading-6 text-ink-soft">
              {mode === "race"
                ? raceSettingsSummary(
                    format,
                    playerLimit,
                    raceEliminationEnabled,
                  )
                : `${ROOM_FORMAT_SHORT[format]} · 接力对局`}
            </p>
            <label className="mb-4 block">
              <span className="mb-1 block text-[0.75rem] text-ink-soft">
                昵称（可选，≤16 字符）
              </span>
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
              className="mt-auto flex min-h-[48px] w-full items-center justify-center gap-2 rounded-[6px] bg-vermilion px-4 py-2.5 font-bold text-white hover:bg-vermilion-dark disabled:opacity-50"
            >
              <Users size={16} aria-hidden="true" />
              {busy === "create" ? "创建中……" : "创建房间"}
            </button>
          </div>

          <div className="flex h-full flex-col rounded-[6px] border border-line bg-paper p-5 shadow-sm">
            <h2 className="mt-0 mb-1 flex items-center gap-2 text-[1rem] font-bold">
              <DoorOpen size={17} className="text-jade" aria-hidden="true" />
              加入房间
            </h2>
            <p className="mt-0 mb-4 text-[0.78rem] text-ink-soft">
              输入好友分享的 6 位房间号。
            </p>
            <label className="mb-2 block">
              <span className="mb-1 block text-[0.75rem] text-ink-soft">
                房间号
              </span>
              <input
                value={joinCode}
                onChange={(e) => {
                  setJoinCode(e.target.value);
                  setInfo(null);
                  setInfoError(false);
                }}
                onBlur={precheck}
                placeholder="如 ABC123（自动忽略空格/连字符）"
                className="w-full rounded-[6px] border border-line-strong bg-paper px-3 py-2 font-mono text-[0.9rem] uppercase outline-none focus:border-vermilion"
                maxLength={12}
              />
            </label>
            {infoLoading && (
              <p className="mt-0 mb-2 text-[0.72rem] text-ink-soft">查询中……</p>
            )}
            {info && (
              <p className="mt-0 mb-2 text-[0.72rem] text-jade">
                房间存在 ·{" "}
                {MULTIPLAYER_MODE_LABELS[info.mode as MultiplayerMode] ??
                  info.mode}
                {info.mode === "relay" ? ` ${info.turnSeconds}s` : ""} ·{" "}
                {ROOM_FORMAT_LABELS[info.format as MultiRoomFormat]} · 玩家{" "}
                {info.playerCount}/{info.playerLimit} · 最少 {info.minPlayers}{" "}
                人开局
                {info.spectatorCount > 0
                  ? ` · 观战 ${info.spectatorCount}`
                  : ""}
              </p>
            )}
            {codeValid && infoError && !infoLoading && (
              <p className="mt-0 mb-2 text-[0.72rem] text-vermilion">
                未找到该房间或查询过于频繁，请稍后再试。
              </p>
            )}
            <button
              type="button"
              disabled={!info}
              onClick={() => setHostScopeOpen(true)}
              className="mb-4 inline-flex h-9 items-center justify-center gap-1.5 rounded-[6px] border border-line-strong bg-paper-muted px-3 text-[0.78rem] font-bold text-ink-soft hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Eye size={15} aria-hidden="true" />
              查看房主所设题库
            </button>
            <label className="mb-4 block">
              <span className="mb-1 block text-[0.75rem] text-ink-soft">
                昵称（可选，≤16 字符）
              </span>
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
              className="mt-auto flex min-h-[48px] w-full items-center justify-center gap-2 rounded-[6px] bg-jade px-4 py-2.5 font-bold text-white hover:bg-[#1b5a50] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <DoorOpen size={16} aria-hidden="true" />
              {busy === "join"
                ? "加入中……"
                : info?.joinRole === "spectator"
                  ? "进入观战"
                  : "加入房间"}
            </button>
          </div>
        </div>
      </div>
      <QuestionScopeDialog
        open={scopeOpen}
        onClose={() => setScopeOpen(false)}
      />
      <QuestionScopeDialog
        open={hostScopeOpen}
        title="房主题库设置"
        readOnly
        initialConfig={
          (info?.questionScope ?? null) as QuestionScopeConfig | null
        }
        onClose={() => setHostScopeOpen(false)}
      />
    </section>
  );
}

function ModeRulePopover({
  mode,
  nPlayerRaceEnabled,
}: {
  mode: MultiplayerMode;
  nPlayerRaceEnabled: boolean;
}) {
  const rule =
    mode === "race" && !nPlayerRaceEnabled ? DUO_RACE_RULE : MODE_RULES[mode];
  return (
    <div
      id={`mode-rule-${mode}`}
      role="tooltip"
      className="mode-rule-popover pointer-events-none absolute right-0 bottom-[calc(100%+10px)] left-0 z-20 rounded-[6px] border border-line bg-paper px-3 py-2.5 text-left text-[0.72rem] font-normal leading-[1.65] text-ink shadow-lg"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {rule}
      </ReactMarkdown>
    </div>
  );
}
