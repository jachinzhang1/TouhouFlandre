"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, ChevronDown, ChevronRight, Minus } from "lucide-react";
import {
  CHARACTER_GUESS_FIELDS,
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
  type GuessFieldDefinition,
  type QuestionScopeConfig,
  type QuestionScopeRules,
} from "@touhouflandre/shared";
import { useStickyState } from "../../hooks/useStickyState";
import {
  Paper,
  PaperButton,
  PaperNumberInput,
  PaperRange,
  PaperSegmentGroup,
  PaperSegmentSeparator,
  PaperSwitch,
} from "@/components/paper";
import { CharacterAvatar } from "../game/CharacterAvatar";
import { VisualAlign } from "../layout/VisualAlign";

const DEFAULT_FIELD_DEFINITIONS: GuessFieldDefinition[] =
  CHARACTER_GUESS_FIELDS.map((field) => ({
    key: field.key,
    label: field.label,
    type: field.type,
    helpText: field.helpText,
    configurable: true,
    defaultMode: field.key === "releaseYear" ? "directional" : "default",
    modes:
      field.key === "releaseYear"
        ? [
            { key: "directional", label: "方向性提示", enabled: true },
            { key: "exactOnly", label: "仅精确", enabled: true },
            { key: "hidden", label: "隐藏", enabled: false },
          ]
        : [
            { key: "default", label: "显示", enabled: true },
            { key: "hidden", label: "隐藏", enabled: false },
          ],
    equivalence: false,
  }));

type WorkScopeState = ReturnType<typeof buildQuestionScopeWorkStates>[number];

interface QuestionScopeEditorProps {
  draft: QuestionScopeConfig;
  snapshot: FullCatalogSnapshot;
  onFilterStickyChange?: (stuck: boolean) => void;
  readOnly: boolean;
  onChange: (config: QuestionScopeConfig) => void;
}

export function QuestionScopeEditor({
  draft,
  onFilterStickyChange,
  snapshot,
  readOnly,
  onChange,
}: QuestionScopeEditorProps) {
  const [filterTab, setFilterTab] = useState<"work" | "character">("work");
  const [openSection, setOpenSection] = useState<
    "presets" | "rules" | "filters" | null
  >(null);
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
  const fieldDefinitions = snapshot.fieldDefinitions?.length
    ? snapshot.fieldDefinitions
    : DEFAULT_FIELD_DEFINITIONS;
  const rules = normalizeQuestionScopeRules(draft.rules, fieldDefinitions);
  const currentDifficulty = draft.difficulty ?? "normal";

  const updateRules = (nextRules: QuestionScopeRules) => {
    if (readOnly) return;
    onChange(updateQuestionScopeRules(draft, snapshot, nextRules));
  };
  const updateFieldMode = (field: string, mode: string) => {
    updateRules({
      ...rules,
      fieldModes: { ...rules.fieldModes, [field]: mode },
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
      <ScopeSection
        open={openSection === "presets"}
        title="预设难度选择"
        onToggle={() =>
          setOpenSection((current) =>
            current === "presets" ? null : "presets",
          )
        }
      >
        <PaperSegmentGroup
          className="question-scope-preset-group"
          label="预设难度选择"
        >
          {QUESTION_DIFFICULTY_PRESETS.map((preset, index) => {
            const active = currentDifficulty === preset;
            return (
              <Fragment key={preset}>
                {index > 0 ? (
                  <PaperSegmentSeparator orientation="responsive" />
                ) : null}
                <Paper
                  animateOnMount={false}
                  ariaChecked={active}
                  as="button"
                  className="question-scope-preset"
                  disabled={readOnly}
                  preserveAppearanceWhenDisabled={readOnly}
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

      <ScopeSection
        open={openSection === "rules"}
        title="标签与单手限制"
        onToggle={() =>
          setOpenSection((current) => (current === "rules" ? null : "rules"))
        }
      >
        <div className="question-scope-field-grid">
          {fieldDefinitions
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
                  className="question-scope-release-control"
                  key={definition.key}
                >
                  <ScopeToggleButton
                    checked={checked}
                    disabled={readOnly}
                    preserveAppearanceWhenDisabled={readOnly}
                    label={definition.label}
                    onClick={() =>
                      updateFieldMode(
                        definition.key,
                        checked
                          ? (hiddenMode ?? "hidden")
                          : (enabledModes[0]?.key ?? definition.defaultMode),
                      )
                    }
                  />
                  {enabledModes.length > 1 ? (
                    <>
                      <PaperSegmentSeparator orientation="responsive" />
                      <select
                        aria-label={`${definition.label}比较模式`}
                        className="question-scope-field-mode-select"
                        disabled={readOnly || !checked}
                        onChange={(event) =>
                          updateFieldMode(definition.key, event.target.value)
                        }
                        value={checked ? mode : enabledModes[0]?.key}
                      >
                        {enabledModes.map((candidate) => (
                          <option key={candidate.key} value={candidate.key}>
                            {candidate.label}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : null}
                </div>
              );
            })}
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
        open={openSection === "filters"}
        title="作品与角色筛选"
        onToggle={() =>
          setOpenSection((current) =>
            current === "filters" ? null : "filters",
          )
        }
      >
        <ScopeFilterSection
          activeTab={filterTab}
          answerableCount={answerableCount}
          onSelect={setAllCharacters}
          onStickyChange={onFilterStickyChange}
          onTabChange={setFilterTab}
          readOnly={readOnly}
          selectedCount={draft.selectedCharacterIds.length}
        >
          {filterTab === "work" ? (
            <WorkFilterContent
              draft={draft}
              onChange={onChange}
              readOnly={readOnly}
              snapshot={snapshot}
              stateByWorkId={stateByWorkId}
            />
          ) : (
            <CharacterFilterContent
              draft={draft}
              onChange={onChange}
              readOnly={readOnly}
              selected={selected}
              snapshot={snapshot}
              sortedCharacters={sortedCharacters}
            />
          )}
        </ScopeFilterSection>
      </ScopeSection>
    </div>
  );
}

function ScopeFilterSection({
  activeTab,
  answerableCount,
  children,
  onSelect,
  onStickyChange,
  onTabChange,
  readOnly,
  selectedCount,
}: {
  activeTab: "work" | "character";
  answerableCount: number;
  children: ReactNode;
  onSelect: (checked: boolean) => void;
  onStickyChange?: (stuck: boolean) => void;
  onTabChange: (tab: "work" | "character") => void;
  readOnly: boolean;
  selectedCount: number;
}) {
  const headingRef = useRef<HTMLElement>(null);
  const stuck = useStickyState(headingRef);
  useEffect(() => {
    onStickyChange?.(stuck);
  }, [onStickyChange, stuck]);
  useEffect(
    () => () => {
      onStickyChange?.(false);
    },
    [onStickyChange],
  );

  return (
    <section className="question-scope-filter-section">
      <header
        className="question-scope-filter-heading"
        data-stuck={stuck ? "true" : "false"}
        ref={headingRef}
      >
        <div className="question-scope-section-title-row">
          <span className="question-scope-section-rule" aria-hidden="true" />
          <div
            className="question-scope-filter-tabs"
            role="tablist"
            aria-label="题库筛选方式"
          >
            <button
              aria-controls="question-scope-filter-panel"
              aria-selected={activeTab === "work"}
              className="question-scope-filter-tab"
              id="question-scope-filter-work"
              onClick={() => onTabChange("work")}
              role="tab"
              type="button"
            >
              按作品筛选
            </button>
            <PaperSegmentSeparator />
            <button
              aria-controls="question-scope-filter-panel"
              aria-selected={activeTab === "character"}
              className="question-scope-filter-tab"
              id="question-scope-filter-character"
              onClick={() => onTabChange("character")}
              role="tab"
              type="button"
            >
              按角色筛选
            </button>
          </div>
          <span
            className="question-scope-section-rule question-scope-section-rule-right"
            aria-hidden="true"
          />
        </div>
        <div className="question-scope-filter-actions">
          <VisualAlign
            as="span"
            className="question-scope-selected-count"
            edge="mobile-start"
            inset="padded-label"
          >
            已选择 {selectedCount}/{answerableCount} 个角色
          </VisualAlign>
          <BulkSelectControls readOnly={readOnly} onSelect={onSelect} />
        </div>
      </header>
      <div
        aria-labelledby={
          activeTab === "work"
            ? "question-scope-filter-work"
            : "question-scope-filter-character"
        }
        id="question-scope-filter-panel"
        role="tabpanel"
      >
        {children}
      </div>
    </section>
  );
}

function WorkFilterContent({
  draft,
  onChange,
  readOnly,
  snapshot,
  stateByWorkId,
}: {
  draft: QuestionScopeConfig;
  onChange: (config: QuestionScopeConfig) => void;
  readOnly: boolean;
  snapshot: FullCatalogSnapshot;
  stateByWorkId: Map<string, WorkScopeState>;
}) {
  return (
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
            pattern={false}
            disabled={readOnly || (state?.totalCount ?? 0) === 0}
            preserveAppearanceWhenDisabled={readOnly}
            folded={active}
            foldSize={10}
            key={work.id}
            onClick={() =>
              onChange(toggleWorkInQuestionScope(draft, snapshot, work.id))
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
  );
}

function CharacterFilterContent({
  draft,
  onChange,
  readOnly,
  selected,
  snapshot,
  sortedCharacters,
}: {
  draft: QuestionScopeConfig;
  onChange: (config: QuestionScopeConfig) => void;
  readOnly: boolean;
  selected: Set<string>;
  snapshot: FullCatalogSnapshot;
  sortedCharacters: FullCatalogSnapshot["characters"];
}) {
  return (
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
            pattern={false}
            disabled={readOnly || !enabled}
            preserveAppearanceWhenDisabled={readOnly}
            folded={checked}
            foldSize={10}
            key={character.id}
            onClick={() =>
              onChange(
                toggleCharacterInQuestionScope(draft, snapshot, character.id),
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
  );
}

function ScopeSection({
  children,
  open,
  onToggle,
  title,
}: {
  children: ReactNode;
  open: boolean;
  onToggle: () => void;
  title: ReactNode;
}) {
  return (
    <section
      className="question-scope-section"
      data-open={open ? "true" : "false"}
    >
      <button
        aria-expanded={open}
        className="question-scope-disclosure-heading"
        onClick={onToggle}
        type="button"
      >
        <span>{title}</span>
        {open ? (
          <ChevronDown size={17} aria-hidden="true" />
        ) : (
          <ChevronRight size={17} aria-hidden="true" />
        )}
      </button>
      {open ? (
        <div className="question-scope-disclosure-body">{children}</div>
      ) : null}
    </section>
  );
}

function ScopeToggleButton({
  checked,
  disabled,
  label,
  onClick,
  preserveAppearanceWhenDisabled = false,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
  preserveAppearanceWhenDisabled?: boolean;
}) {
  const prominent = checked;
  return (
    <Paper
      animateOnMount={false}
      ariaChecked={checked}
      as="button"
      className="question-scope-toggle-button"
      pattern={false}
      disabled={disabled}
      preserveAppearanceWhenDisabled={preserveAppearanceWhenDisabled}
      folded={prominent}
      foldSize={9}
      onClick={onClick}
      role="checkbox"
      sticker={false}
      unfoldOnHover={prominent && !disabled}
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
      <Paper
        animateOnMount={false}
        as="div"
        className="question-scope-limit-label"
        folded={false}
        pattern={false}
        sticker={false}
        unfoldOnHover={false}
      >
        <span>{label}</span>
        <PaperSwitch
          ariaLabel={label}
          checked={enabled}
          disabled={readOnly}
          preserveAppearanceWhenDisabled={readOnly}
          onChange={onEnabledChange}
        />
      </Paper>
      <PaperSegmentSeparator />
      <PaperRange
        ariaLabel={`${label}滑块`}
        disabled={readOnly || !enabled}
        max={max}
        min={min}
        onChange={onValueChange}
        preserveAppearanceWhenDisabled={readOnly && enabled}
        value={value}
      />
      <PaperSegmentSeparator orientation="responsive" />
      <PaperNumberInput
        ariaLabel={`${label}数值`}
        disabled={readOnly || !enabled}
        max={max}
        min={min}
        onChange={onValueChange}
        preserveAppearanceWhenDisabled={readOnly && enabled}
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
