"use client";

import { useMemo, useState } from "react";
import { InputNumber, Slider, Switch, Tooltip } from "antd";
import { Check, ChevronDown, ChevronRight, Minus, Search } from "lucide-react";
import {
  applyQuestionScopePreset,
  buildQuestionScopeWorkStates,
  normalizeQuestionScope,
  normalizeQuestionScopeRules,
  QUESTION_DIFFICULTY_DESCRIPTIONS,
  QUESTION_DIFFICULTY_LABELS,
  QUESTION_DIFFICULTY_PRESETS,
  QUESTION_SCOPE_DEFAULT_GUESSES,
  QUESTION_SCOPE_MAX_GUESSES,
  QUESTION_SCOPE_MAX_TURN_SECONDS,
  QUESTION_SCOPE_MIN_GUESSES,
  QUESTION_SCOPE_MIN_TURN_SECONDS,
  QUESTION_SCOPE_SCHEMA_VERSION,
  toggleCharacterInQuestionScope,
  toggleWorkInQuestionScope,
  updateQuestionScopeRules,
  type FullCatalogSnapshot,
  type QuestionScopeConfig,
  type QuestionScopeRules,
} from "@touhouflandre/shared";
import { CharacterAvatar } from "../game/CharacterAvatar";

const FIELD_TOGGLE_LABELS = [
  ["firstAppearance", "初登场作品"],
  ["species", "种族"],
  ["affiliations", "阵营"],
  ["locations", "地点"],
  ["hairColors", "头发颜色"],
] as const;

interface QuestionScopeEditorProps {
  draft: QuestionScopeConfig;
  snapshot: FullCatalogSnapshot;
  readOnly: boolean;
  onChange: (config: QuestionScopeConfig) => void;
}

export function QuestionScopeEditor({
  draft,
  snapshot,
  readOnly,
  onChange,
}: QuestionScopeEditorProps) {
  const [workFilterOpen, setWorkFilterOpen] = useState(true);
  const selected = useMemo(
    () => new Set(draft.selectedCharacterIds),
    [draft.selectedCharacterIds],
  );
  const stateByWorkId = useMemo(
    () =>
      new Map(
        buildQuestionScopeWorkStates(
          snapshot.works,
          snapshot.characters,
          draft.selectedCharacterIds,
        ).map((state) => [state.workId, state]),
      ),
    [draft.selectedCharacterIds, snapshot.characters, snapshot.works],
  );
  const answerableCount = useMemo(
    () =>
      snapshot.characters.filter((character) => character.enabledAsAnswer)
        .length,
    [snapshot.characters],
  );
  const sortedCharacters = useMemo(
    () =>
      [...snapshot.characters].sort(
        (left, right) =>
          left.appearanceOrder - right.appearanceOrder ||
          left.id.localeCompare(right.id),
      ),
    [snapshot.characters],
  );
  const rules = normalizeQuestionScopeRules(draft.rules);
  const currentDifficulty = draft.difficulty ?? "normal";

  const updateRules = (nextRules: QuestionScopeRules) => {
    if (readOnly) return;
    onChange(updateQuestionScopeRules(draft, snapshot, nextRules));
  };
  const updateField = <Key extends keyof QuestionScopeRules["fields"]>(
    field: Key,
    value: QuestionScopeRules["fields"][Key],
  ) => {
    updateRules({
      ...rules,
      fields: { ...rules.fields, [field]: value },
    });
  };
  const setAllCharacters = (checked: boolean) => {
    if (readOnly) return;
    const selectedCharacterIds = checked
      ? snapshot.characters
          .filter((character) => character.enabledAsAnswer)
          .map((character) => character.id)
      : [];
    if (selectedCharacterIds.length === 0) {
      onChange({
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
    onChange(
      normalizeQuestionScope({ ...draft, selectedCharacterIds }, snapshot)
        .config,
    );
  };

  return (
    <div className="grid gap-4">
      <section>
        <h3 className="mb-2 text-sm font-black text-ink">预设难度选择</h3>
        <div className="grid gap-2 md:grid-cols-4">
          {QUESTION_DIFFICULTY_PRESETS.map((preset) => {
            const active = currentDifficulty === preset;
            return (
              <button
                key={preset}
                type="button"
                disabled={readOnly}
                className={`min-h-[84px] rounded-[6px] border px-3 py-2.5 text-left transition ${
                  active
                    ? "border-vermilion bg-vermilion-soft text-vermilion"
                    : "border-line bg-paper-muted text-ink hover:bg-paper"
                } disabled:cursor-default`}
                onClick={() =>
                  !readOnly &&
                  onChange(applyQuestionScopePreset(snapshot, preset))
                }
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
        <h3 className="mb-2 text-sm font-black text-ink">标签与单手限时设置</h3>
        <div className="grid gap-2 rounded-[6px] border border-line bg-paper-muted p-3">
          <div className="grid gap-2 md:grid-cols-3">
            {FIELD_TOGGLE_LABELS.map(([field, label]) => {
              const checked = rules.fields[field];
              return (
                <button
                  key={field}
                  type="button"
                  disabled={readOnly}
                  role="checkbox"
                  aria-checked={checked}
                  className="flex min-h-[40px] items-center gap-2 rounded-[5px] border border-line bg-paper px-2.5 py-1.5 text-left text-sm text-ink hover:bg-paper-muted disabled:cursor-default disabled:opacity-60"
                  onClick={() => updateField(field, !checked)}
                >
                  <BinaryCheck checked={checked} />
                  <span className="font-bold">{label}</span>
                </button>
              );
            })}
            <div className="flex min-h-[40px] items-center justify-between gap-2 rounded-[5px] border border-line bg-paper px-2.5 py-1.5">
              <button
                type="button"
                disabled={readOnly}
                role="checkbox"
                aria-checked={rules.fields.releaseYear !== "hidden"}
                className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-ink disabled:cursor-default disabled:opacity-60"
                onClick={() =>
                  updateField(
                    "releaseYear",
                    rules.fields.releaseYear === "hidden"
                      ? "directional"
                      : "hidden",
                  )
                }
              >
                <BinaryCheck checked={rules.fields.releaseYear !== "hidden"} />
                <strong className="block min-w-0 truncate">初登场年份</strong>
              </button>
              <Tooltip title="是否开启年份偏高或偏低提示">
                <span className="shrink-0">
                  <Switch
                    size="small"
                    checked={rules.fields.releaseYear === "directional"}
                    disabled={readOnly || rules.fields.releaseYear === "hidden"}
                    onChange={(checked) =>
                      updateField(
                        "releaseYear",
                        checked ? "directional" : "exactOnly",
                      )
                    }
                  />
                </span>
              </Tooltip>
            </div>
          </div>
          <div className="grid gap-2 border-t border-line pt-2 md:grid-cols-[150px_minmax(0,1fr)_86px] md:items-center">
            <label className="flex items-center justify-between gap-2 text-sm font-bold text-ink">
              <span>设置单手限时</span>
              <Switch
                size="small"
                checked={rules.turnLimit.enabled}
                disabled={readOnly}
                onChange={(checked) =>
                  updateRules({
                    ...rules,
                    turnLimit: {
                      enabled: checked,
                      seconds: rules.turnLimit.seconds,
                    },
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
                  updateRules({
                    ...rules,
                    turnLimit: {
                      enabled: rules.turnLimit.enabled,
                      seconds: value,
                    },
                  });
                }
              }}
            />
            <InputNumber
              min={QUESTION_SCOPE_MIN_TURN_SECONDS}
              max={QUESTION_SCOPE_MAX_TURN_SECONDS}
              addonAfter="s"
              size="small"
              value={rules.turnLimit.seconds}
              disabled={readOnly || !rules.turnLimit.enabled}
              onChange={(value) =>
                updateRules({
                  ...rules,
                  turnLimit: {
                    enabled: rules.turnLimit.enabled,
                    seconds:
                      typeof value === "number"
                        ? value
                        : QUESTION_SCOPE_MIN_TURN_SECONDS,
                  },
                })
              }
            />
          </div>
          <GuessLimitControls
            guessLimit={rules.guessLimit}
            readOnly={readOnly}
            onChange={(guessLimit) => updateRules({ ...rules, guessLimit })}
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
          <BulkSelectControls readOnly={readOnly} onSelect={setAllCharacters} />
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
                  onClick={() =>
                    !readOnly &&
                    onChange(
                      toggleWorkInQuestionScope(draft, snapshot, work.id),
                    )
                  }
                >
                  <TriStateIcon state={state?.state ?? "none"} />
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate">{work.titleZh}</strong>
                    <small className="mt-0.5 block text-[0.72rem] text-ink-soft">
                      {work.shortName} · {state?.selectedCount ?? 0}/
                      {state?.totalCount ?? 0}
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
          <BulkSelectControls readOnly={readOnly} onSelect={setAllCharacters} />
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
                onClick={() =>
                  !readOnly &&
                  onChange(
                    toggleCharacterInQuestionScope(
                      draft,
                      snapshot,
                      character.id,
                    ),
                  )
                }
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
  );
}

function BulkSelectControls({
  readOnly,
  onSelect,
}: {
  readOnly: boolean;
  onSelect: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        disabled={readOnly}
        className="h-7 rounded-[5px] border border-line px-2.5 text-xs font-bold text-ink hover:bg-paper-muted disabled:cursor-default disabled:opacity-50"
        onClick={() => onSelect(true)}
      >
        全选
      </button>
      <button
        type="button"
        disabled={readOnly}
        className="h-7 rounded-[5px] border border-line px-2.5 text-xs font-bold text-ink hover:bg-paper-muted disabled:cursor-default disabled:opacity-50"
        onClick={() => onSelect(false)}
      >
        全不选
      </button>
    </div>
  );
}

function TriStateIcon({ state }: { state: "all" | "partial" | "none" }) {
  return (
    <span
      className={`inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] border ${
        state === "none"
          ? "border-line-strong bg-paper"
          : "border-vermilion bg-vermilion text-white"
      }`}
      aria-hidden="true"
    >
      {state === "all" ? (
        <Check size={14} />
      ) : state === "partial" ? (
        <Minus size={14} />
      ) : null}
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
        addonAfter="手"
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
