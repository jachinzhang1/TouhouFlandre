"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
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
import { Paper } from "../Paper";
import { PaperButton } from "../controls/PaperButton";
import {
  PaperNumberInput,
  PaperRange,
  PaperSwitch,
} from "../controls/PaperNumericControls";
import {
  PaperSegmentGroup,
  PaperSegmentSeparator,
} from "../controls/PaperSegmentedControl";
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
    <div className="question-scope-editor">
      <ScopeSection title="预设难度选择">
        <PaperSegmentGroup
          className="question-scope-preset-group"
          label="预设难度选择"
        >
          {QUESTION_DIFFICULTY_PRESETS.map((preset, index) => {
            const active = currentDifficulty === preset;
            return (
              <Fragment key={preset}>
                {index > 0 ? <PaperSegmentSeparator /> : null}
                <Paper
                  animateOnMount={false}
                  ariaChecked={active}
                  as="button"
                  className="question-scope-preset"
                  disabled={readOnly}
                  folded={active}
                  foldSize={12}
                  onClick={() =>
                    onChange(applyQuestionScopePreset(snapshot, preset))
                  }
                  role="radio"
                  sticker={false}
                  unfoldOnHover={active}
                  variant={active ? "tinted" : "plain"}
                >
                  <strong>
                    {QUESTION_DIFFICULTY_LABELS[preset]}
                    {active ? <Check size={16} aria-hidden="true" /> : null}
                  </strong>
                  <span>{QUESTION_DIFFICULTY_DESCRIPTIONS[preset]}</span>
                </Paper>
              </Fragment>
            );
          })}
        </PaperSegmentGroup>
      </ScopeSection>

      <ScopeSection title="标签与单手限制">
        <div className="question-scope-field-grid">
          {FIELD_TOGGLE_LABELS.map(([field, label]) => (
            <ScopeToggleButton
              checked={Boolean(rules.fields[field])}
              disabled={readOnly}
              key={field}
              label={label}
              onClick={() => updateField(field, !rules.fields[field])}
            />
          ))}
          <div className="question-scope-release-control">
            <ScopeToggleButton
              checked={rules.fields.releaseYear !== "hidden"}
              disabled={readOnly}
              label="初登场年份"
              onClick={() =>
                updateField(
                  "releaseYear",
                  rules.fields.releaseYear === "hidden"
                    ? "directional"
                    : "hidden",
                )
              }
            />
            <div className="question-scope-release-direction">
              <span>方向性提示</span>
              <PaperSwitch
                ariaLabel="年份方向性提示"
                checked={rules.fields.releaseYear === "directional"}
                disabled={readOnly || rules.fields.releaseYear === "hidden"}
                onChange={(checked) =>
                  updateField(
                    "releaseYear",
                    checked ? "directional" : "exactOnly",
                  )
                }
              />
            </div>
          </div>
        </div>

        <div className="question-scope-rule-stack">
          <LimitControl
            enabled={rules.turnLimit.enabled}
            label="设置单手限时"
            max={QUESTION_SCOPE_MAX_TURN_SECONDS}
            min={QUESTION_SCOPE_MIN_TURN_SECONDS}
            readOnly={readOnly}
            suffix="秒"
            value={rules.turnLimit.seconds}
            onEnabledChange={(enabled) =>
              updateRules({
                ...rules,
                turnLimit: { ...rules.turnLimit, enabled },
              })
            }
            onValueChange={(seconds) =>
              updateRules({
                ...rules,
                turnLimit: { enabled: rules.turnLimit.enabled, seconds },
              })
            }
          />
          <LimitControl
            enabled={rules.guessLimit.enabled}
            label="设置猜测次数限制"
            max={QUESTION_SCOPE_MAX_GUESSES}
            min={QUESTION_SCOPE_MIN_GUESSES}
            readOnly={readOnly}
            suffix="手"
            value={rules.guessLimit.maxGuesses}
            onEnabledChange={(enabled) =>
              updateRules({
                ...rules,
                guessLimit: { ...rules.guessLimit, enabled },
              })
            }
            onValueChange={(maxGuesses) =>
              updateRules({
                ...rules,
                guessLimit: {
                  enabled: rules.guessLimit.enabled,
                  maxGuesses:
                    Number.isFinite(maxGuesses) && maxGuesses > 0
                      ? maxGuesses
                      : QUESTION_SCOPE_DEFAULT_GUESSES,
                },
              })
            }
          />
        </div>
      </ScopeSection>

      <ScopeSection
        action={
          <BulkSelectControls readOnly={readOnly} onSelect={setAllCharacters} />
        }
        title={
          <PaperButton
            ariaLabel={workFilterOpen ? "收起作品筛选" : "展开作品筛选"}
            className="question-scope-collapse"
            folded={false}
            onClick={() => setWorkFilterOpen((value) => !value)}
          >
            {workFilterOpen ? (
              <ChevronDown size={18} aria-hidden="true" />
            ) : (
              <ChevronRight size={18} aria-hidden="true" />
            )}
            按作品筛选
          </PaperButton>
        }
      >
        {workFilterOpen ? (
          <div className="question-scope-option-grid">
            {snapshot.works.map((work) => {
              const state = stateByWorkId.get(work.id);
              const checked =
                state?.state === "all"
                  ? true
                  : state?.state === "partial"
                    ? "mixed"
                    : false;
              const active = checked !== false;
              return (
                <Paper
                  animateOnMount={false}
                  ariaChecked={checked}
                  as="button"
                  className="question-scope-option-card"
                  disabled={readOnly || (state?.totalCount ?? 0) === 0}
                  folded={active}
                  foldSize={10}
                  key={work.id}
                  onClick={() =>
                    onChange(
                      toggleWorkInQuestionScope(draft, snapshot, work.id),
                    )
                  }
                  role="checkbox"
                  sticker={false}
                  unfoldOnHover={active}
                  variant={active ? "tinted" : "plain"}
                >
                  <TriStateIcon state={state?.state ?? "none"} />
                  <span className="question-scope-option-copy">
                    <strong>{work.titleZh}</strong>
                    <small>
                      {work.shortName} · {state?.selectedCount ?? 0}/
                      {state?.totalCount ?? 0}
                    </small>
                  </span>
                </Paper>
              );
            })}
          </div>
        ) : null}
      </ScopeSection>

      <ScopeSection
        action={
          <BulkSelectControls readOnly={readOnly} onSelect={setAllCharacters} />
        }
        title={
          <span className="question-scope-character-title">
            <span>按角色筛选</span>
            <Search size={18} aria-hidden="true" />
            <small>
              已选择 {draft.selectedCharacterIds.length}/{answerableCount}
            </small>
          </span>
        }
      >
        <div className="question-scope-character-grid">
          {sortedCharacters.map((character) => {
            const enabled = character.enabledAsAnswer;
            const checked = selected.has(character.id);
            return (
              <Paper
                animateOnMount={false}
                ariaChecked={checked}
                as="button"
                className="question-scope-character-card"
                disabled={readOnly || !enabled}
                folded={checked}
                foldSize={10}
                key={character.id}
                onClick={() =>
                  onChange(
                    toggleCharacterInQuestionScope(
                      draft,
                      snapshot,
                      character.id,
                    ),
                  )
                }
                role="checkbox"
                sticker={false}
                unfoldOnHover={checked}
                variant={checked ? "tinted" : "plain"}
              >
                <CharacterAvatar
                  avatarUrl={character.avatarUrl}
                  name={character.names.zhHans}
                  initials={character.names.zhHans.slice(0, 2)}
                  className="size-10"
                />
                <span className="question-scope-option-copy">
                  <strong>{character.names.zhHans}</strong>
                  <small>
                    {character.firstAppearance.workTitle}
                    {!enabled ? " · 不可作答案" : ""}
                  </small>
                </span>
                <BinaryCheck checked={checked} />
              </Paper>
            );
          })}
        </div>
      </ScopeSection>
    </div>
  );
}

function ScopeSection({
  action,
  children,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  title: ReactNode;
}) {
  return (
    <section className="question-scope-section">
      <header className="question-scope-section-heading">
        <div className="question-scope-section-title-row">
          <span className="question-scope-section-rule" aria-hidden="true" />
          {typeof title === "string" ? <h2>{title}</h2> : title}
          <span
            className="question-scope-section-rule question-scope-section-rule-right"
            aria-hidden="true"
          />
        </div>
        {action ? (
          <div className="question-scope-section-actions">{action}</div>
        ) : null}
      </header>
      {children}
    </section>
  );
}

function ScopeToggleButton({
  checked,
  disabled,
  label,
  onClick,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  const prominent = checked && !disabled;
  return (
    <Paper
      animateOnMount={false}
      ariaChecked={checked}
      as="button"
      className="question-scope-toggle-button"
      disabled={disabled}
      folded={prominent}
      foldSize={9}
      onClick={onClick}
      role="checkbox"
      sticker={false}
      unfoldOnHover={prominent}
      variant={prominent ? "tinted" : "plain"}
    >
      <BinaryCheck checked={checked} />
      <span>{label}</span>
    </Paper>
  );
}

function LimitControl({
  enabled,
  label,
  max,
  min,
  onEnabledChange,
  onValueChange,
  readOnly,
  suffix,
  value,
}: {
  enabled: boolean;
  label: string;
  max: number;
  min: number;
  onEnabledChange: (enabled: boolean) => void;
  onValueChange: (value: number) => void;
  readOnly: boolean;
  suffix: string;
  value: number;
}) {
  return (
    <PaperSegmentGroup className="question-scope-limit-control" label={label}>
      <div className="question-scope-limit-label">
        <span>{label}</span>
        <PaperSwitch
          ariaLabel={label}
          checked={enabled}
          disabled={readOnly}
          onChange={onEnabledChange}
        />
      </div>
      <PaperSegmentSeparator />
      <PaperRange
        ariaLabel={`${label}滑块`}
        disabled={readOnly || !enabled}
        max={max}
        min={min}
        onChange={onValueChange}
        value={value}
      />
      <PaperSegmentSeparator />
      <PaperNumberInput
        ariaLabel={`${label}数值`}
        disabled={readOnly || !enabled}
        max={max}
        min={min}
        onChange={onValueChange}
        suffix={suffix}
        value={value}
      />
    </PaperSegmentGroup>
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
    <PaperSegmentGroup
      className="question-scope-bulk-controls"
      label="批量选择"
    >
      <PaperButton
        disabled={readOnly}
        folded={false}
        onClick={() => onSelect(true)}
      >
        全选
      </PaperButton>
      <PaperSegmentSeparator />
      <PaperButton
        disabled={readOnly}
        folded={false}
        onClick={() => onSelect(false)}
      >
        全不选
      </PaperButton>
    </PaperSegmentGroup>
  );
}

function TriStateIcon({ state }: { state: "all" | "partial" | "none" }) {
  return (
    <span
      className="question-scope-selection-mark"
      data-state={state}
      aria-hidden="true"
    >
      {state === "all" ? (
        <Check size={18} />
      ) : state === "partial" ? (
        <Minus size={18} />
      ) : (
        <span className="question-scope-empty-square" />
      )}
    </span>
  );
}

function BinaryCheck({ checked }: { checked: boolean }) {
  return (
    <span
      className="question-scope-selection-mark"
      data-state={checked ? "all" : "none"}
      aria-hidden="true"
    >
      {checked ? (
        <Check size={18} />
      ) : (
        <span className="question-scope-empty-square" />
      )}
    </span>
  );
}
