"use client";

import {
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  Minus,
  Search,
  Settings,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ConfigProvider,
  InputNumber,
  Slider,
  Switch,
  message as globalMessage,
} from "antd";
import {
  applyQuestionScopePreset,
  buildQuestionScopeWorkStates,
  normalizeQuestionScope,
  normalizeQuestionScopeRules,
  presetQuestionScopeIds,
  QUESTION_DIFFICULTY_DESCRIPTIONS,
  QUESTION_DIFFICULTY_LABELS,
  QUESTION_DIFFICULTY_PRESETS,
  QUESTION_SCOPE_SCHEMA_VERSION,
  QUESTION_SCOPE_DEFAULT_GUESSES,
  QUESTION_SCOPE_MAX_GUESSES,
  QUESTION_SCOPE_MAX_TURN_SECONDS,
  QUESTION_SCOPE_MIN_GUESSES,
  QUESTION_SCOPE_MIN_TURN_SECONDS,
  toggleCharacterInQuestionScope,
  toggleWorkInQuestionScope,
  updateQuestionScopeRules,
  type FullCatalogSnapshot,
  type QuestionDifficultyPreset,
  type QuestionScopeConfig,
  type QuestionScopeRules,
} from "@touhouflandre/shared";
import { CharacterAvatar } from "./CharacterAvatar";
import { api } from "../lib/api";
import {
  catalogFullToSnapshot,
  loadLocalQuestionScope,
  saveLocalQuestionScope,
} from "../lib/questionScopeStorage";

type Props = {
  open: boolean;
  initialConfig?: QuestionScopeConfig | null;
  readOnly?: boolean;
  title?: string;
  onApply?: (config: QuestionScopeConfig) => void;
  onClose: () => void;
};

type QuestionScopeExportFile = {
  kind: "touhouflandre.questionScope";
  exportedAt: string;
  questionScope: QuestionScopeConfig;
};

export function QuestionScopeDialog({
  open,
  initialConfig,
  readOnly = false,
  title = "题库设置",
  onApply,
  onClose,
}: Props) {
  const [snapshot, setSnapshot] = useState<FullCatalogSnapshot | null>(null);
  const [draft, setDraft] = useState<QuestionScopeConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [workFilterOpen, setWorkFilterOpen] = useState(true);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    const load = async () => {
      setLoading(true);
      setError("");
      setNotice("");
      setWorkFilterOpen(true);
      try {
        const loaded = catalogFullToSnapshot(await api.catalogFull());
        if (disposed) return;
        const correction =
          initialConfig || readOnly
            ? normalizeQuestionScope(initialConfig ?? null, loaded)
            : loadLocalQuestionScope(loaded);
        setSnapshot(loaded);
        setDraft(correction.config);
        if (correction.changed && !readOnly) {
          setNotice("题库已随新版本自动整理。");
        }
      } catch (caught) {
        if (!disposed) {
          setError(caught instanceof Error ? caught.message : "题库加载失败。");
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [initialConfig, open, readOnly]);

  const selected = useMemo(
    () => new Set(draft?.selectedCharacterIds ?? []),
    [draft?.selectedCharacterIds],
  );
  const workStates = useMemo(
    () =>
      snapshot && draft
        ? buildQuestionScopeWorkStates(
            snapshot.works,
            snapshot.characters,
            draft.selectedCharacterIds,
          )
        : [],
    [draft, snapshot],
  );
  const stateByWorkId = useMemo(
    () => new Map(workStates.map((state) => [state.workId, state])),
    [workStates],
  );
  const answerableCount = useMemo(
    () => snapshot?.characters.filter((character) => character.enabledAsAnswer).length ?? 0,
    [snapshot?.characters],
  );
  const sortedCharacters = useMemo(
    () =>
      [...(snapshot?.characters ?? [])].sort(
        (left, right) =>
          left.appearanceOrder - right.appearanceOrder ||
          left.id.localeCompare(right.id),
      ),
    [snapshot?.characters],
  );

  if (!open) return null;

  const currentDifficulty = draft?.difficulty ?? "normal";
  const invalidScope = Boolean(
    !readOnly && draft && draft.selectedCharacterIds.length === 0,
  );
  const rules = normalizeQuestionScopeRules(
    draft?.rules,
    snapshot?.fieldDefinitions ?? [],
    draft?.mode === "custom" ? "hidden" : undefined,
  );
  const updateRules = (nextRules: QuestionScopeRules) => {
    if (!snapshot || !draft || readOnly) return;
    setDraft(updateQuestionScopeRules(draft, snapshot, nextRules));
  };
  const updateFieldMode = (field: string, mode: string) => {
    updateRules({
      ...rules,
      fieldModes: {
        ...rules.fieldModes,
        [field]: mode,
      },
    });
  };
  const updateTurnLimit = (turnLimit: QuestionScopeRules["turnLimit"]) => {
    updateRules({
      ...rules,
      turnLimit,
    });
  };
  const updateGuessLimit = (guessLimit: QuestionScopeRules["guessLimit"]) => {
    updateRules({
      ...rules,
      guessLimit,
    });
  };
  const applyPreset = (preset: QuestionDifficultyPreset) => {
    if (!snapshot || readOnly) return;
    setDraft(applyQuestionScopePreset(snapshot, preset));
  };
  const toggleWork = (workId: string) => {
    if (!snapshot || !draft || readOnly) return;
    setDraft(toggleWorkInQuestionScope(draft, snapshot, workId));
  };
  const toggleCharacter = (characterId: string) => {
    if (!snapshot || !draft || readOnly) return;
    setDraft(toggleCharacterInQuestionScope(draft, snapshot, characterId));
  };
  const setAllCharacters = (checked: boolean) => {
    if (!snapshot || !draft || readOnly) return;
    const selectedCharacterIds = checked
      ? snapshot.characters
          .filter((character) => character.enabledAsAnswer)
          .map((character) => character.id)
      : [];
    if (selectedCharacterIds.length === 0) {
      setDraft({
        ...draft,
        schemaVersion: QUESTION_SCOPE_SCHEMA_VERSION,
        mode: "custom",
        difficulty: "custom",
        selectedCharacterIds,
        workStates: buildQuestionScopeWorkStates(
          snapshot.works,
          snapshot.characters,
          selectedCharacterIds,
        ),
      });
      return;
    }
    setDraft(
      normalizeQuestionScope(
        {
          ...draft,
          selectedCharacterIds,
        },
        snapshot,
      ).config,
    );
  };
  const apply = () => {
    if (!snapshot || !draft || readOnly) {
      onClose();
      return;
    }
    const corrected = normalizeQuestionScope(draft, snapshot).config;
    saveLocalQuestionScope(corrected);
    onApply?.(corrected);
    onClose();
    globalMessage.success("题库修改成功，将在新游戏中生效");
  };
  const exportConfig = () => {
    if (!snapshot || !draft) return;
    const corrected = normalizeQuestionScope(draft, snapshot).config;
    const file: QuestionScopeExportFile = {
      kind: "touhouflandre.questionScope",
      exportedAt: new Date().toISOString(),
      questionScope: corrected,
    };
    const blob = new Blob([JSON.stringify(file, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `touhouflandre-question-scope-${file.exportedAt.slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };
  const importConfig = async (file?: File) => {
    if (!file || !snapshot || readOnly) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const candidate =
        parsed &&
        typeof parsed === "object" &&
        "questionScope" in parsed
          ? (parsed as { questionScope?: unknown }).questionScope
          : parsed;
      if (!candidate || typeof candidate !== "object") {
        throw new Error("文件中没有可用的题库设置。");
      }
      if (!window.confirm("当前操作将覆盖现有题库设置，是否确认导入？")) {
        return;
      }
      const correction = normalizeQuestionScope(
        candidate as Partial<QuestionScopeConfig>,
        snapshot,
      );
      saveLocalQuestionScope(correction.config);
      setDraft(correction.config);
      setNotice(
        correction.changed
          ? "导入的题库已按当前版本自动整理。"
          : "题库设置已导入。",
      );
      onApply?.(correction.config);
      globalMessage.success("题库设置导入成功");
    } catch (caught) {
      globalMessage.error(
        caught instanceof Error
          ? `题库设置导入失败：${caught.message}`
          : "题库设置导入失败。",
      );
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6">
      <ConfigProvider
        theme={{
          token: {
            borderRadius: 5,
            colorBgContainer: "var(--surface)",
            colorBorder: "var(--line)",
            colorPrimary: "var(--vermilion)",
            colorPrimaryBg: "var(--accent-soft)",
            colorPrimaryHover: "var(--vermilion-dark)",
            colorText: "var(--ink)",
            colorTextSecondary: "var(--ink-soft)",
            colorBgElevated: "var(--surface)",
            colorFillSecondary: "var(--surface-soft)",
            fontFamily: "var(--font-ui)",
          },
        }}
      >
      <section
        className="flex max-h-[88vh] w-full max-w-[1040px] flex-col overflow-hidden rounded-[8px] border border-line bg-paper shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="question-scope-title"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <p
              className={`mb-1 text-[0.72rem] font-bold ${
                invalidScope ? "text-[var(--error-text)]" : "text-ink-soft"
              }`}
            >
              {invalidScope
                ? "当前题库状态无效，若应用将自动改为Normal难度"
                : `当前难度：${QUESTION_DIFFICULTY_LABELS[currentDifficulty]}`}
            </p>
            <h2 id="question-scope-title" className="text-lg font-black text-ink">
              {title}
            </h2>
            {notice ? (
              <p className="mt-1 text-[0.76rem] font-semibold text-jade">
                {notice}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-[5px] text-ink-soft hover:bg-paper-muted"
            title="关闭"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="grid min-h-[320px] place-items-center text-sm text-ink-soft">
              <span className="inline-flex items-center gap-2">
                <Loader2 className="spin" size={18} aria-hidden="true" />
                正在读取题库
              </span>
            </div>
          ) : error ? (
            <div className="rounded-[6px] border border-vermilion-soft bg-vermilion-soft px-4 py-3 text-sm text-vermilion">
              {error}
            </div>
          ) : snapshot && draft ? (
            <div className="grid gap-4">
              <section>
                <h3 className="mb-2 text-sm font-black text-ink">预设难度选择</h3>
                <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-5">
                  {QUESTION_DIFFICULTY_PRESETS.map((preset) => {
                    const active = currentDifficulty === preset;
                    const available =
                      presetQuestionScopeIds(preset, snapshot.characters).length > 0;
                    return (
                      <button
                        key={preset}
                        type="button"
                        disabled={readOnly || !available}
                        title={available ? undefined : "当前题库暂无此难度角色"}
                        className={`min-h-[84px] rounded-[6px] border px-3 py-2.5 text-left transition ${
                          active
                            ? "border-vermilion bg-vermilion-soft text-vermilion"
                            : "border-line bg-paper-muted text-ink hover:bg-paper"
                        } disabled:cursor-default disabled:opacity-60`}
                        onClick={() => applyPreset(preset)}
                      >
                        <strong className="flex items-center gap-1 text-[0.9rem]">
                          {QUESTION_DIFFICULTY_LABELS[preset]}
                          {active ? <Check size={15} aria-hidden="true" /> : null}
                        </strong>
                        <span className="mt-1 block text-[0.72rem] leading-5 text-ink-soft">
                          {QUESTION_DIFFICULTY_DESCRIPTIONS[preset]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-black text-ink">
                  标签与单手限时设置
                </h3>
                <div className="grid gap-2 rounded-[6px] border border-line bg-paper-muted p-3">
                  <div className="grid gap-2 md:grid-cols-3">
                    {(snapshot.fieldDefinitions ?? [])
                      .filter((definition) => definition.configurable)
                      .map((definition) => {
                      const mode =
                        rules.fieldModes[definition.key] ?? definition.defaultMode;
                      const selectedMode = definition.modes.find(
                        (candidate) => candidate.key === mode,
                      );
                      const checked = selectedMode?.enabled === true;
                      const enabledModes = definition.modes.filter(
                        (candidate) => candidate.enabled,
                      );
                      const hiddenMode = definition.modes.find(
                        (candidate) => !candidate.enabled,
                      )?.key;
                      return (
                        <div
                          key={definition.key}
                          className="flex min-h-[40px] items-center justify-between gap-2 rounded-[5px] border border-line bg-paper px-2.5 py-1.5"
                        >
                          <button
                            type="button"
                            disabled={readOnly}
                            role="checkbox"
                            aria-checked={checked}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-ink disabled:cursor-default disabled:opacity-60"
                            onClick={() =>
                              updateFieldMode(
                                definition.key,
                                checked
                                  ? (hiddenMode ?? "hidden")
                                  : (enabledModes[0]?.key ?? definition.defaultMode),
                              )
                            }
                          >
                            <BinaryCheck checked={checked} />
                            <span className="min-w-0 truncate font-bold">
                              {definition.label}
                            </span>
                          </button>
                          {enabledModes.length > 1 ? (
                            <select
                              aria-label={`${definition.label}比较模式`}
                              className="h-7 max-w-[112px] rounded-[4px] border border-line bg-paper px-1.5 text-xs text-ink disabled:opacity-50"
                              value={checked ? mode : enabledModes[0]?.key}
                              disabled={readOnly || !checked}
                              onChange={(event) =>
                                updateFieldMode(definition.key, event.target.value)
                              }
                            >
                              {enabledModes.map((candidate) => (
                                <option key={candidate.key} value={candidate.key}>
                                  {candidate.label}
                                </option>
                              ))}
                            </select>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  <div className="grid gap-2 border-t border-line pt-2 md:grid-cols-[150px_minmax(0,1fr)_86px] md:items-center">
                    <label className="flex items-center justify-between gap-2 text-sm font-bold text-ink">
                      <span>设置单手限时</span>
                      <Switch
                        size="small"
                        checked={rules.turnLimit.enabled}
                        disabled={readOnly}
                        onChange={(checked) =>
                          updateTurnLimit({
                            enabled: checked,
                            seconds: rules.turnLimit.seconds,
                          })
                        }
                      />
                    </label>
                    <Slider
                      min={QUESTION_SCOPE_MIN_TURN_SECONDS}
                      max={QUESTION_SCOPE_MAX_TURN_SECONDS}
                      value={rules.turnLimit.seconds}
                      disabled={readOnly || !rules.turnLimit.enabled}
                      onChange={(value) => {
                        if (typeof value === "number") {
                          updateTurnLimit({
                            enabled: rules.turnLimit.enabled,
                            seconds: value,
                          });
                        }
                      }}
                    />
                    <InputNumber
                      min={QUESTION_SCOPE_MIN_TURN_SECONDS}
                      max={QUESTION_SCOPE_MAX_TURN_SECONDS}
                      suffix="s"
                      size="small"
                      value={rules.turnLimit.seconds}
                      disabled={readOnly || !rules.turnLimit.enabled}
                      onChange={(value) =>
                        updateTurnLimit({
                          enabled: rules.turnLimit.enabled,
                          seconds:
                            typeof value === "number"
                              ? value
                              : QUESTION_SCOPE_MIN_TURN_SECONDS,
                        })
                      }
                    />
                  </div>
                  <GuessLimitControls
                    guessLimit={rules.guessLimit}
                    readOnly={readOnly}
                    onChange={updateGuessLimit}
                  />
                </div>
              </section>

              <section>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    className="flex items-center gap-1 text-left"
                    aria-expanded={workFilterOpen}
                    onClick={() => setWorkFilterOpen((value) => !value)}
                  >
                    {workFilterOpen ? (
                      <ChevronDown size={16} aria-hidden="true" />
                    ) : (
                      <ChevronRight size={16} aria-hidden="true" />
                    )}
                    <span className="text-sm font-black text-ink">按作品筛选</span>
                  </button>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={readOnly}
                      className="h-7 rounded-[5px] border border-line px-2.5 text-xs font-bold text-ink hover:bg-paper-muted disabled:cursor-default disabled:opacity-50"
                      onClick={() => setAllCharacters(true)}
                    >
                      全选
                    </button>
                    <button
                      type="button"
                      disabled={readOnly}
                      className="h-7 rounded-[5px] border border-line px-2.5 text-xs font-bold text-ink hover:bg-paper-muted disabled:cursor-default disabled:opacity-50"
                      onClick={() => setAllCharacters(false)}
                    >
                      全不选
                    </button>
                  </div>
                </div>
                {workFilterOpen ? (
                  <div className="grid gap-1.5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {snapshot.works.map((work) => {
                      const state = stateByWorkId.get(work.id);
                      const checked =
                        state?.state === "all"
                          ? true
                          : state?.state === "partial"
                            ? "mixed"
                            : false;
                      return (
                        <button
                          key={work.id}
                          type="button"
                          disabled={readOnly || (state?.totalCount ?? 0) === 0}
                          className="flex min-h-[46px] items-center gap-2.5 rounded-[5px] border border-line bg-paper-muted px-2.5 py-1.5 text-left text-sm text-ink hover:bg-paper disabled:cursor-default disabled:opacity-60"
                          role="checkbox"
                          aria-checked={checked}
                          onClick={() => toggleWork(work.id)}
                        >
                          <TriStateIcon state={state?.state ?? "none"} />
                          <span className="min-w-0 flex-1">
                            <strong className="block truncate">{work.titleZh}</strong>
                            <small className="mt-0.5 block text-[0.72rem] text-ink-soft">
                              {work.shortName} · {state?.selectedCount ?? 0}/{state?.totalCount ?? 0}
                            </small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </section>

              <section>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-black text-ink">按角色筛选</h3>
                    <Search size={16} className="text-ink-soft" aria-hidden="true" />
                    <span className="text-[0.76rem] font-bold text-ink-soft">
                      已选择 {draft.selectedCharacterIds.length}/{answerableCount}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={readOnly}
                      className="h-7 rounded-[5px] border border-line px-2.5 text-xs font-bold text-ink hover:bg-paper-muted disabled:cursor-default disabled:opacity-50"
                      onClick={() => setAllCharacters(true)}
                    >
                      全选
                    </button>
                    <button
                      type="button"
                      disabled={readOnly}
                      className="h-7 rounded-[5px] border border-line px-2.5 text-xs font-bold text-ink hover:bg-paper-muted disabled:cursor-default disabled:opacity-50"
                      onClick={() => setAllCharacters(false)}
                    >
                      全不选
                    </button>
                  </div>
                </div>
                <div className="grid gap-1.5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {sortedCharacters.map((character) => {
                    const enabled = character.enabledAsAnswer;
                    const checked = selected.has(character.id);
                    return (
                      <button
                        key={character.id}
                        type="button"
                        disabled={readOnly || !enabled}
                        className={`grid min-h-[58px] grid-cols-[36px_minmax(0,1fr)_24px] items-center gap-2.5 rounded-[5px] border px-2.5 py-1.5 text-left ${
                          checked
                            ? "border-vermilion bg-vermilion-soft"
                            : "border-line bg-paper-muted hover:bg-paper"
                        } disabled:cursor-default disabled:opacity-60`}
                        onClick={() => toggleCharacter(character.id)}
                      >
                        <CharacterAvatar
                          avatarUrl={character.avatarUrl}
                          name={character.names.zhHans}
                          initials={character.names.zhHans.slice(0, 2)}
                          className="size-9"
                        />
                        <span className="min-w-0">
                          <strong className="block truncate text-sm text-ink">
                            {character.names.zhHans}
                          </strong>
                          <small className="mt-0.5 block truncate text-[0.72rem] text-ink-soft">
                            {character.firstAppearance.workTitle}
                            {!enabled ? " · 不可作答案" : ""}
                          </small>
                        </span>
                        <span
                          className={`inline-flex size-6 items-center justify-center rounded-[4px] border ${
                            checked
                              ? "border-vermilion bg-vermilion text-white"
                              : "border-line-strong bg-paper"
                          }`}
                          aria-hidden="true"
                        >
                          {checked ? <Check size={15} /> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
          {!readOnly ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={importInputRef}
                className="sr-only"
                type="file"
                accept="application/json,.json"
                onChange={(event) => void importConfig(event.target.files?.[0])}
              />
              <button
                type="button"
                disabled={!draft || !snapshot || loading}
                className="inline-flex h-9 items-center gap-2 rounded-[5px] border border-line px-3 text-xs font-bold text-ink hover:bg-paper-muted disabled:cursor-default disabled:opacity-50"
                onClick={exportConfig}
              >
                <Upload size={15} aria-hidden="true" />
                导出
              </button>
              <button
                type="button"
                disabled={!snapshot || loading}
                className="inline-flex h-9 items-center gap-2 rounded-[5px] border border-line px-3 text-xs font-bold text-ink hover:bg-paper-muted disabled:cursor-default disabled:opacity-50"
                onClick={() => importInputRef.current?.click()}
              >
                <Download size={15} aria-hidden="true" />
                导入
              </button>
            </div>
          ) : (
            <span aria-hidden="true" />
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-[5px] border border-line px-4 text-sm font-bold text-ink hover:bg-paper-muted"
              onClick={onClose}
            >
              <X size={15} aria-hidden="true" />
              取消
            </button>
            {!readOnly ? (
              <button
                type="button"
                disabled={!draft || loading}
                className="inline-flex h-9 items-center gap-2 rounded-[5px] bg-vermilion px-4 text-sm font-bold text-[var(--accent-contrast)] disabled:opacity-50"
                onClick={apply}
              >
                <Settings size={15} aria-hidden="true" />
                应用
              </button>
            ) : null}
          </div>
        </footer>
      </section>
      </ConfigProvider>
    </div>
  );
}

function TriStateIcon({
  state,
}: {
  state: "all" | "partial" | "none";
}) {
  return (
    <span
      className={`inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] border ${
        state === "none"
          ? "border-line-strong bg-paper"
          : "border-vermilion bg-vermilion text-white"
      }`}
      aria-hidden="true"
    >
      {state === "all" ? <Check size={14} /> : state === "partial" ? <Minus size={14} /> : null}
    </span>
  );
}

function BinaryCheck({ checked }: { checked: boolean }) {
  return (
    <span
      className={`inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] border ${
        checked
          ? "border-vermilion bg-vermilion text-white"
          : "border-line-strong bg-paper"
      }`}
      aria-hidden="true"
    >
      {checked ? <Check size={14} /> : null}
    </span>
  );
}

function GuessLimitControls({
  guessLimit,
  readOnly,
  onChange,
}: {
  guessLimit: QuestionScopeRules["guessLimit"];
  readOnly: boolean;
  onChange: (guessLimit: QuestionScopeRules["guessLimit"]) => void;
}) {
  return (
    <div className="grid gap-2 border-t border-line pt-2 md:grid-cols-[150px_minmax(0,1fr)_86px] md:items-center">
      <label className="flex items-center justify-between gap-2 text-sm font-bold text-ink">
        <span>设置猜测次数限制</span>
        <Switch
          size="small"
          checked={guessLimit.enabled}
          disabled={readOnly}
          onChange={(checked) =>
            onChange({
              enabled: checked,
              maxGuesses: guessLimit.maxGuesses,
            })
          }
        />
      </label>
      <Slider
        min={QUESTION_SCOPE_MIN_GUESSES}
        max={QUESTION_SCOPE_MAX_GUESSES}
        value={guessLimit.maxGuesses}
        disabled={readOnly || !guessLimit.enabled}
        onChange={(value) => {
          if (typeof value === "number") {
            onChange({
              enabled: guessLimit.enabled,
              maxGuesses: value,
            });
          }
        }}
      />
      <InputNumber
        min={QUESTION_SCOPE_MIN_GUESSES}
        max={QUESTION_SCOPE_MAX_GUESSES}
        suffix="手"
        size="small"
        value={guessLimit.maxGuesses}
        disabled={readOnly || !guessLimit.enabled}
        onChange={(value) =>
          onChange({
            enabled: guessLimit.enabled,
            maxGuesses:
              typeof value === "number"
                ? value
                : QUESTION_SCOPE_DEFAULT_GUESSES,
          })
        }
      />
    </div>
  );
}
