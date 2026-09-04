"use client";

// 多人大厅（08 §10.1）：创建房间（赛制单选 + 昵称）、加入房间（房间号 + 昵称 + 公开预检）。
import { useRouter } from "next/navigation";
import { Check, DoorOpen, Eye, Settings, Users } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { MultiRoomFormat, MultiplayerMode } from "@touhouflandre/shared";
import type { components } from "../../generated/api";

type RoomInfo = components["schemas"]["RoomInfo"];
import {
  isValidRoomCode,
  MULTIPLAYER_MODE_DESCRIPTIONS,
  MULTIPLAYER_MODE_LABELS,
  normalizeRoomCode,
  ROOM_FORMAT_LABELS,
  ROOM_FORMAT_SHORT,
  saveMultiRoom,
  TURN_SECONDS_OPTIONS,
  type RelayTurnSeconds,
} from "../../domain/multiRoom";
import { api } from "../../lib/api";
import {
  catalogFullToSnapshot,
  loadLocalQuestionScope,
} from "../../lib/questionScopeStorage";
import { isNPlayerRaceUiEnabled } from "../../config/multiplayerRollout";
import {
  clearMultiplayerGameSeed,
  installGameSeedConsole,
  MULTIPLAYER_DEVELOPMENT_ROOM_CODE,
  MULTIPLAYER_GAME_SEED_PRESETS,
  parseMultiplayerGameSeedPreset,
  storeMultiplayerGameSeed,
} from "../../dev/gameSeeds";
import {
  Paper,
  PaperButton,
  PaperRadioGroup,
  PaperRadioOption,
  PaperRange,
  PaperSegmentButton,
  PaperSegmentGroup,
  PaperSegmentSeparator,
  PaperTextInput,
} from "@/components/paper";
import {
  PageBackLink,
  PageHeader,
  PageHeaderAction,
} from "../layout/PageHeader";
import { SectionHeading } from "../layout/SectionHeading";

const FORMATS: MultiRoomFormat[] = ["bo1", "bo3", "bo5", "bo7"];
const MODES: MultiplayerMode[] = ["race", "relay"];
const MODE_RULES: Record<MultiplayerMode, string> = {
  race: `**竞速模式**中，2 至 8 名玩家会同时竞猜同一个隐藏角色，每局限时 **5 分钟**。出题范围和猜测次数限制**由房主决定**。己方棋盘可以看到完整的猜测记录和字段反馈，对手棋盘则只显示标签命中情况。

实际开局为 2 人时使用所选双人赛制，率先猜中者赢得本局。实际开局超过 2 人时使用积分淘汰制：猜中越快，本局得分越高；放弃、次数耗尽或超时得 0 分。达到淘汰轮次后，每局会淘汰累计积分最低的玩家，直至决出最终排行榜。`,
  relay: `**接力模式**中，双方共用同一张棋盘并轮流行动，出题范围和猜测次数限制**由房主决定**。当前轮到的玩家可以提交一次猜测或主动选择空过。猜测、主动空过和超时空过都会计入自己的轮次。提交正确角色的一方赢得本局；若双方都用尽轮次仍无人猜中，或本局总倒计时结束，则本局判为平局。

接力房间会为每一手设置单独限时。轮到自己时若在限时内没有提交，会自动记为超时空过并轮到对方；主动空过与超时空过共享每人每局 **2 次**空过额度，额度耗尽后再次空过会导致该玩家本局判负。`,
};
const DUO_RACE_RULE = `**竞速模式**中，两名玩家会同时竞猜同一个隐藏角色，每局限时 **5 分钟**。出题范围和猜测次数限制**由房主决定**。己方棋盘可以看到完整的猜测记录和字段反馈，对手棋盘则只显示标签命中情况。

率先猜中者赢得本局，并按所选双人赛制决定整场胜负。`;
const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : "操作失败。";

export function MultiLobby() {
  const router = useRouter();
  const [format, setFormat] = useState<MultiRoomFormat>("bo3");
  const [mode, setMode] = useState<MultiplayerMode>("race");
  const [turnSeconds, setTurnSeconds] = useState<RelayTurnSeconds>(60);
  const [playerLimit, setPlayerLimit] = useState(2);
  const [nickname, setNickname] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [joinNickname, setJoinNickname] = useState("");
  const [info, setInfo] = useState<RoomInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoError, setInfoError] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const nPlayerRaceEnabled = isNPlayerRaceUiEnabled();
  useEffect(() => {
    return installGameSeedConsole({
      page: "multiplayer",
      presets: MULTIPLAYER_GAME_SEED_PRESETS,
      seed: (value) => {
        const preset = parseMultiplayerGameSeedPreset(value);
        storeMultiplayerGameSeed(preset);
        router.push(`/multi/room/${MULTIPLAYER_DEVELOPMENT_ROOM_CODE}`);
        return preset;
      },
      reset: clearMultiplayerGameSeed,
    });
  }, [router]);

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
        turnSeconds,
        displayName: nickname || undefined,
        questionScope,
      });
      clearMultiplayerGameSeed();
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
      clearMultiplayerGameSeed();
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
    <section className="multi-lobby-page">
      <PageHeader
        description="创建房间或输入房间号加入，与好友实时竞猜同一个隐藏角色。"
        leftSlot={<PageBackLink href="/single" />}
        rightSlot={
          <PageHeaderAction
            ariaLabel="题库设置"
            onClick={() => router.push("/settings?source=multi")}
          >
            <Settings size={18} aria-hidden="true" />
            题库设置
          </PageHeaderAction>
        }
        rightSlotInset="leading-icon-action"
        title="多人大厅"
      />

      <div className="multi-lobby-content">
        {error ? (
          <Paper
            animateOnMount={false}
            as="div"
            className="multi-lobby-error"
            folded={false}
            pattern={false}
            role="alert"
            sticker={false}
            tone="danger"
            unfoldOnHover={false}
          >
            {error}
          </Paper>
        ) : null}

        <div className="multi-lobby-layout">
          <Paper
            animateOnMount={false}
            as="article"
            className="multi-lobby-pane"
            elevation="sm"
            folded={false}
            pattern={false}
            sticker={false}
            unfoldOnHover={false}
          >
            <SectionHeading
              description="选择玩法和赛制，创建房间后邀请好友加入。"
              title="创建房间"
            />

            <div className="multi-lobby-fieldset">
              <span className="multi-lobby-field-label">玩法</span>
              <PaperSegmentGroup
                className="multi-lobby-mode-group"
                label="玩法"
              >
                {MODES.map((option, index) => (
                  <Fragment key={option}>
                    {index > 0 ? <PaperSegmentSeparator /> : null}
                    <PaperSegmentButton
                      active={mode === option}
                      ariaDescribedBy={`mode-rule-${option}`}
                      className="mode-option"
                      folded={false}
                      onClick={() => setMode(option)}
                    >
                      <span className="multi-lobby-segment-copy">
                        <span>{MULTIPLAYER_MODE_LABELS[option]}</span>
                        <span className="multi-lobby-segment-description">
                          {MULTIPLAYER_MODE_DESCRIPTIONS[option]}
                        </span>
                      </span>
                      <ModeRulePopover
                        mode={option}
                        nPlayerRaceEnabled={nPlayerRaceEnabled}
                      />
                    </PaperSegmentButton>
                  </Fragment>
                ))}
              </PaperSegmentGroup>
              <ModeRulePopover
                mobile
                mode={mode}
                nPlayerRaceEnabled={nPlayerRaceEnabled}
              />
            </div>

            {mode === "relay" ? (
              <fieldset className="multi-lobby-fieldset">
                <legend className="multi-lobby-field-label">单手时限</legend>
                <PaperRadioGroup
                  className="multi-lobby-four-option-group"
                  label="单手时限"
                >
                  {TURN_SECONDS_OPTIONS.map((seconds) => (
                    <PaperRadioOption
                      checked={turnSeconds === seconds}
                      className="tabular-nums"
                      key={seconds}
                      onSelect={() => setTurnSeconds(seconds)}
                    >
                      {seconds}s
                    </PaperRadioOption>
                  ))}
                </PaperRadioGroup>
              </fieldset>
            ) : null}

            {mode === "race" && nPlayerRaceEnabled ? (
              <div className="multi-lobby-fieldset">
                <span className="multi-lobby-field-label">玩家上限</span>
                <div
                  aria-label="玩家上限"
                  className="multi-lobby-capacity-control"
                  role="group"
                >
                  <PaperRange
                    ariaLabel="玩家上限（2-8）"
                    max={8}
                    min={2}
                    onChange={setPlayerLimit}
                    value={playerLimit}
                    valueLabel={`${playerLimit} 人`}
                    valueText={`${playerLimit} 人`}
                  />
                </div>
              </div>
            ) : null}

            <div className="multi-lobby-fieldset">
              <span className="multi-lobby-field-label">双人赛制</span>
              <PaperRadioGroup
                className="multi-lobby-format-group"
                label="双人赛制"
              >
                {FORMATS.map((roomFormat) => {
                  const selected = format === roomFormat;
                  return (
                    <PaperRadioOption
                      checked={selected}
                      className="multi-lobby-format-option"
                      key={roomFormat}
                      onSelect={() => setFormat(roomFormat)}
                    >
                      <span className="multi-lobby-segment-copy">
                        <span className="multi-lobby-format-title">
                          {ROOM_FORMAT_SHORT[roomFormat]}
                          {selected ? (
                            <Check
                              aria-hidden="true"
                              className="multi-lobby-format-check"
                              size={15}
                            />
                          ) : null}
                        </span>
                        <span className="multi-lobby-segment-description">
                          {ROOM_FORMAT_LABELS[roomFormat].split(" · ")[1]}
                        </span>
                      </span>
                    </PaperRadioOption>
                  );
                })}
              </PaperRadioGroup>
            </div>

            <div className="multi-lobby-fieldset">
              <span className="multi-lobby-field-label">
                昵称（可选，≤16 字符）
              </span>
              <PaperTextInput
                ariaLabel="创建房间昵称"
                maxLength={16}
                onChange={(event) => setNickname(event.target.value)}
                placeholder="匿名玩家"
                value={nickname}
              />
            </div>

            <PaperButton
              className="multi-lobby-primary-action"
              disabled={busy !== null}
              filled
              onClick={handleCreate}
              tone="theme"
            >
              <Users size={16} aria-hidden="true" />
              {busy === "create" ? "创建中……" : "创建房间"}
            </PaperButton>
          </Paper>

          <Paper
            animateOnMount={false}
            as="article"
            className="multi-lobby-pane"
            elevation="sm"
            folded={false}
            pattern={false}
            sticker={false}
            unfoldOnHover={false}
          >
            <SectionHeading
              description="输入好友分享的 6 位房间号。"
              title="加入房间"
            />

            <div className="multi-lobby-fieldset">
              <span className="multi-lobby-field-label">房间号</span>
              <PaperTextInput
                ariaLabel="房间号"
                aria-describedby="multi-lobby-join-help"
                inputClassName="font-mono uppercase"
                maxLength={12}
                onBlur={precheck}
                onChange={(event) => {
                  setJoinCode(event.target.value);
                  setInfo(null);
                  setInfoError(false);
                }}
                placeholder="如 ABC123（自动忽略空格/连字符）"
                value={joinCode}
              />
            </div>

            <p
              aria-live="polite"
              className={`multi-lobby-field-help ${
                info
                  ? "multi-lobby-status-success"
                  : codeValid && infoError && !infoLoading
                    ? "multi-lobby-status-error"
                    : ""
              }`}
              id="multi-lobby-join-help"
            >
              {infoLoading
                ? "正在检查房间……"
                : info
                  ? `已找到房间 · ${
                      MULTIPLAYER_MODE_LABELS[info.mode as MultiplayerMode] ??
                      info.mode
                    }${info.mode === "relay" ? ` ${info.turnSeconds}s` : ""} · ${
                      ROOM_FORMAT_LABELS[info.format as MultiRoomFormat]
                    } · 玩家 ${info.playerCount}/${info.playerLimit}${
                      info.spectatorCount > 0
                        ? ` · 观战 ${info.spectatorCount}`
                        : ""
                    }`
                  : codeValid && infoError
                    ? "未找到该房间，或查询过于频繁；请稍后重试。"
                    : joinCode.trim()
                      ? "房间号应为 6 位字母或数字；空格与连字符会自动忽略。"
                      : "输入好友分享的 6 位房间号；检查通过后即可加入。"}
            </p>

            <PaperButton
              className="multi-lobby-secondary-action"
              disabled={!info}
              folded={false}
              onClick={() =>
                router.push(
                  `/settings?source=multi&room=${encodeURIComponent(normalizedCode)}`,
                )
              }
            >
              <Eye size={15} aria-hidden="true" />
              查看房主所设题库
            </PaperButton>

            <div className="multi-lobby-fieldset">
              <span className="multi-lobby-field-label">
                昵称（可选，≤16 字符）
              </span>
              <PaperTextInput
                ariaLabel="加入房间昵称"
                maxLength={16}
                onChange={(event) => setJoinNickname(event.target.value)}
                placeholder="匿名玩家"
                value={joinNickname}
              />
            </div>

            <PaperButton
              className="multi-lobby-primary-action"
              disabled={busy !== null || !codeValid}
              filled
              onClick={handleJoin}
              tone="theme"
            >
              <DoorOpen size={16} aria-hidden="true" />
              {busy === "join"
                ? "加入中……"
                : info?.joinRole === "spectator"
                  ? "进入观战"
                  : "加入房间"}
            </PaperButton>
          </Paper>
        </div>
      </div>
    </section>
  );
}

function ModeRulePopover({
  mobile = false,
  mode,
  nPlayerRaceEnabled,
}: {
  mobile?: boolean;
  mode: MultiplayerMode;
  nPlayerRaceEnabled: boolean;
}) {
  const rule =
    mode === "race" && !nPlayerRaceEnabled ? DUO_RACE_RULE : MODE_RULES[mode];
  return (
    <Paper
      animateOnMount={false}
      as="div"
      elevation="lg"
      className={mobile ? "mode-rule-disclosure" : "mode-rule-popover"}
      folded={false}
      pattern={false}
      role={mobile ? "note" : "tooltip"}
      sticker={false}
      unfoldOnHover={false}
    >
      <div
        id={mobile ? undefined : `mode-rule-${mode}`}
        className="mode-rule-copy"
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
          {rule}
        </ReactMarkdown>
      </div>
    </Paper>
  );
}
