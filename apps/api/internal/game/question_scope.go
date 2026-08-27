package game

import "sort"

const QuestionScopeSchemaVersion = 3

const (
	QuestionScopeMinTurnSeconds  = 30
	QuestionScopeHardTurnSeconds = 45
	QuestionScopeMaxTurnSeconds  = 120
)

const (
	QuestionScopeMinGuesses       = 1
	QuestionScopeDefaultGuesses   = 8
	QuestionScopeMaxGuesses       = 20
	QuestionScopeUnlimitedGuesses = 999
)

type QuestionDifficulty string

const (
	QuestionDifficultyEasy    QuestionDifficulty = "easy"
	QuestionDifficultyNormal  QuestionDifficulty = "normal"
	QuestionDifficultyHard    QuestionDifficulty = "hard"
	QuestionDifficultyLunatic QuestionDifficulty = "lunatic"
	QuestionDifficultyExtra   QuestionDifficulty = "extra"
	QuestionDifficultyCustom  QuestionDifficulty = "custom"
)

type QuestionScopeMode string

const (
	QuestionScopeModePreset QuestionScopeMode = "preset"
	QuestionScopeModeCustom QuestionScopeMode = "custom"
)

type QuestionScopeWorkSelection string

const (
	QuestionScopeWorkAll     QuestionScopeWorkSelection = "all"
	QuestionScopeWorkPartial QuestionScopeWorkSelection = "partial"
	QuestionScopeWorkNone    QuestionScopeWorkSelection = "none"
)

type QuestionScopeReleaseYearMode string

const (
	QuestionScopeReleaseYearHidden      QuestionScopeReleaseYearMode = "hidden"
	QuestionScopeReleaseYearExactOnly   QuestionScopeReleaseYearMode = "exactOnly"
	QuestionScopeReleaseYearDirectional QuestionScopeReleaseYearMode = "directional"
)

type QuestionScopeFieldRules struct {
	FirstAppearance bool                         `json:"firstAppearance"`
	ReleaseYear     QuestionScopeReleaseYearMode `json:"releaseYear"`
	Species         bool                         `json:"species"`
	Affiliations    bool                         `json:"affiliations"`
	Locations       bool                         `json:"locations"`
	HairColors      bool                         `json:"hairColors"`
}

type QuestionScopeTurnLimit struct {
	Enabled bool `json:"enabled"`
	Seconds int  `json:"seconds"`
}

type QuestionScopeGuessLimit struct {
	Enabled    bool `json:"enabled"`
	MaxGuesses int  `json:"maxGuesses"`
}

type QuestionScopeRules struct {
	FieldModes   map[GuessFieldKey]string `json:"fieldModes,omitempty"`
	TurnLimit    QuestionScopeTurnLimit   `json:"turnLimit"`
	GuessLimit   QuestionScopeGuessLimit  `json:"guessLimit"`
	Fields       *QuestionScopeFieldRules `json:"fields,omitempty"`
	HiddenFields []GuessFieldKey          `json:"hiddenFields,omitempty"`
	TurnSeconds  *int                     `json:"turnSeconds,omitempty"`
}

type QuestionScopeWorkState struct {
	WorkID        string                     `json:"workId"`
	State         QuestionScopeWorkSelection `json:"state"`
	SelectedCount int                        `json:"selectedCount"`
	TotalCount    int                        `json:"totalCount"`
}

type QuestionScopeConfig struct {
	SchemaVersion        int                      `json:"schemaVersion"`
	CatalogVersion       string                   `json:"catalogVersion"`
	Mode                 QuestionScopeMode        `json:"mode"`
	Difficulty           QuestionDifficulty       `json:"difficulty"`
	SelectedCharacterIDs []string                 `json:"selectedCharacterIds"`
	WorkStates           []QuestionScopeWorkState `json:"workStates"`
	Rules                QuestionScopeRules       `json:"rules"`
}

type QuestionScopeWork struct {
	ID string
}

type QuestionScopeCorrection struct {
	Config  QuestionScopeConfig
	Changed bool
	Reason  string
}

type questionScopePresetDefinition struct {
	Difficulty              QuestionDifficulty
	IncludedDifficultyTiers []string
	IncludeAllTiers         bool
	AvailableInDaily        bool
	UnlimitedGuesses        bool
	HideFirstAppearance     bool
	TurnSeconds             int
}

var questionScopePresetDefinitions = []questionScopePresetDefinition{
	{
		Difficulty:              QuestionDifficultyEasy,
		IncludedDifficultyTiers: []string{"easy"},
		AvailableInDaily:        true,
		UnlimitedGuesses:        true,
	},
	{
		Difficulty:              QuestionDifficultyNormal,
		IncludedDifficultyTiers: []string{"easy", "normal"},
		AvailableInDaily:        true,
	},
	{
		Difficulty:              QuestionDifficultyHard,
		IncludedDifficultyTiers: []string{"easy", "normal", "hard"},
		AvailableInDaily:        true,
		TurnSeconds:             QuestionScopeHardTurnSeconds,
	},
	{
		Difficulty:              QuestionDifficultyLunatic,
		IncludedDifficultyTiers: []string{"easy", "normal", "hard", "lunatic"},
		AvailableInDaily:        true,
		HideFirstAppearance:     true,
		TurnSeconds:             QuestionScopeMinTurnSeconds,
	},
	{
		Difficulty:          QuestionDifficultyExtra,
		IncludeAllTiers:     true,
		HideFirstAppearance: true,
		TurnSeconds:         QuestionScopeMinTurnSeconds,
	},
}

func questionScopePresetDefinitionFor(value QuestionDifficulty) (questionScopePresetDefinition, bool) {
	for _, definition := range questionScopePresetDefinitions {
		if definition.Difficulty == value {
			return definition, true
		}
	}
	return questionScopePresetDefinition{}, false
}

func IsQuestionDifficultyPreset(value QuestionDifficulty) bool {
	_, ok := questionScopePresetDefinitionFor(value)
	return ok
}

func IsDailyQuestionDifficulty(value QuestionDifficulty) bool {
	definition, ok := questionScopePresetDefinitionFor(value)
	return ok && definition.AvailableInDaily
}

func PresetQuestionScopeRules(preset QuestionDifficulty) QuestionScopeRules {
	definition, _ := questionScopePresetDefinitionFor(preset)
	rules := QuestionScopeRules{
		FieldModes: CharacterFields.DefaultFieldModes(),
		TurnLimit: QuestionScopeTurnLimit{
			Enabled: false,
			Seconds: QuestionScopeMinTurnSeconds,
		},
		GuessLimit: QuestionScopeGuessLimit{
			Enabled:    true,
			MaxGuesses: QuestionScopeDefaultGuesses,
		},
	}
	if definition.UnlimitedGuesses {
		rules.GuessLimit.Enabled = false
	}
	if definition.TurnSeconds > 0 {
		rules.TurnLimit.Enabled = true
		rules.TurnLimit.Seconds = definition.TurnSeconds
	}
	if definition.HideFirstAppearance {
		rules.FieldModes[FieldFirstAppearance] = FieldModeHidden
	}
	return rules
}

func presetIncludesDifficultyTier(definition questionScopePresetDefinition, tier string) bool {
	if definition.IncludeAllTiers {
		return true
	}
	for _, includedTier := range definition.IncludedDifficultyTiers {
		if tier == includedTier {
			return true
		}
	}
	return false
}

func PresetQuestionScopeIDs(preset QuestionDifficulty, characters []Character) []string {
	definition, ok := questionScopePresetDefinitionFor(preset)
	if !ok {
		return []string{}
	}
	pool := make([]Character, 0, len(characters))
	for _, character := range characters {
		if !character.EnabledAsAnswer {
			continue
		}
		if presetIncludesDifficultyTier(definition, character.DifficultyTier) {
			pool = append(pool, character)
		}
	}
	sort.Slice(pool, func(i, j int) bool {
		if pool[i].AppearanceOrder == pool[j].AppearanceOrder {
			return pool[i].ID < pool[j].ID
		}
		return pool[i].AppearanceOrder < pool[j].AppearanceOrder
	})
	ids := make([]string, 0, len(pool))
	for _, character := range pool {
		ids = append(ids, character.ID)
	}
	return ids
}

func DefaultQuestionScope(catalogVersion string, works []QuestionScopeWork, characters []Character, preset QuestionDifficulty) QuestionScopeConfig {
	if !IsQuestionDifficultyPreset(preset) {
		preset = QuestionDifficultyNormal
	}
	return canonicalQuestionScope(catalogVersion, works, characters, PresetQuestionScopeIDs(preset, characters), PresetQuestionScopeRules(preset), preset)
}

func legacyFieldModes(fields *QuestionScopeFieldRules) map[GuessFieldKey]string {
	modes := CharacterFields.DefaultFieldModes()
	if fields == nil {
		return modes
	}
	if !fields.FirstAppearance {
		modes[FieldFirstAppearance] = FieldModeHidden
	}
	switch fields.ReleaseYear {
	case QuestionScopeReleaseYearHidden:
		modes[FieldReleaseYear] = FieldModeHidden
	case QuestionScopeReleaseYearExactOnly:
		modes[FieldReleaseYear] = FieldModeExactOnly
	default:
		modes[FieldReleaseYear] = FieldModeDirectional
	}
	if !fields.Species {
		modes[FieldSpecies] = FieldModeHidden
	}
	if !fields.Affiliations {
		modes[FieldAffiliations] = FieldModeHidden
	}
	if !fields.Locations {
		modes[FieldLocations] = FieldModeHidden
	}
	if !fields.HairColors {
		modes[FieldHairColors] = FieldModeHidden
	}
	return modes
}

func normalizeQuestionScopeFieldModes(rules QuestionScopeRules, missingMode string) map[GuessFieldKey]string {
	if len(rules.FieldModes) == 0 {
		return legacyFieldModes(rules.Fields)
	}
	modes := make(map[GuessFieldKey]string, len(CharacterFields.Definitions()))
	for _, definition := range CharacterFields.Definitions() {
		mode, ok := rules.FieldModes[definition.Key]
		if !ok {
			mode = missingMode
			if mode == "" {
				mode = definition.DefaultMode
			}
		}
		if !CharacterFields.FieldModeValid(definition.Key, mode) {
			mode = missingMode
			if !CharacterFields.FieldModeValid(definition.Key, mode) {
				mode = definition.DefaultMode
			}
		}
		modes[definition.Key] = mode
	}
	return modes
}

func hideFieldsMissingFromLegacySchema(modes map[GuessFieldKey]string) {
	legacyKeys := map[GuessFieldKey]struct{}{
		FieldFirstAppearance: {},
		FieldReleaseYear:     {},
		FieldSpecies:         {},
		FieldAffiliations:    {},
		FieldLocations:       {},
		FieldHairColors:      {},
	}
	for _, definition := range CharacterFields.Definitions() {
		if _, represented := legacyKeys[definition.Key]; !represented {
			modes[definition.Key] = FieldModeHidden
		}
	}
}

func normalizeQuestionScopeTurnLimit(turnLimit QuestionScopeTurnLimit) QuestionScopeTurnLimit {
	if turnLimit.Seconds < QuestionScopeMinTurnSeconds {
		turnLimit.Seconds = QuestionScopeMinTurnSeconds
	}
	if turnLimit.Seconds > QuestionScopeMaxTurnSeconds {
		turnLimit.Seconds = QuestionScopeMaxTurnSeconds
	}
	return turnLimit
}

func normalizeQuestionScopeGuessLimit(guessLimit QuestionScopeGuessLimit) QuestionScopeGuessLimit {
	if !guessLimit.Enabled && guessLimit.MaxGuesses == 0 {
		return QuestionScopeGuessLimit{Enabled: true, MaxGuesses: QuestionScopeDefaultGuesses}
	}
	if guessLimit.MaxGuesses < QuestionScopeMinGuesses {
		guessLimit.MaxGuesses = QuestionScopeMinGuesses
	}
	if guessLimit.MaxGuesses > QuestionScopeMaxGuesses {
		guessLimit.MaxGuesses = QuestionScopeMaxGuesses
	}
	return guessLimit
}

func normalizeQuestionScopeRules(rules QuestionScopeRules) QuestionScopeRules {
	return QuestionScopeRules{
		FieldModes:   normalizeQuestionScopeFieldModes(rules, ""),
		TurnLimit:    normalizeQuestionScopeTurnLimit(rules.TurnLimit),
		GuessLimit:   normalizeQuestionScopeGuessLimit(rules.GuessLimit),
		Fields:       nil,
		HiddenFields: nil,
		TurnSeconds:  nil,
	}
}

func NormalizeQuestionScopeRules(rules QuestionScopeRules) QuestionScopeRules {
	return normalizeQuestionScopeRules(rules)
}

func EffectiveQuestionScopeMaxGuesses(rules QuestionScopeRules) int {
	guessLimit := normalizeQuestionScopeGuessLimit(rules.GuessLimit)
	if !guessLimit.Enabled {
		return QuestionScopeUnlimitedGuesses
	}
	return guessLimit.MaxGuesses
}

func legacyQuestionScopeRules(rules QuestionScopeRules, requestedPreset QuestionDifficulty, schemaVersion int, custom bool) QuestionScopeRules {
	if schemaVersion >= 2 && rules.Fields != nil {
		normalized := normalizeQuestionScopeRules(rules)
		if custom {
			hideFieldsMissingFromLegacySchema(normalized.FieldModes)
		}
		return normalized
	}
	if requestedPreset == "" {
		requestedPreset = QuestionDifficultyNormal
	}
	normalized := PresetQuestionScopeRules(requestedPreset)
	normalized.GuessLimit = QuestionScopeGuessLimit{Enabled: true, MaxGuesses: QuestionScopeDefaultGuesses}
	hidden := make(map[GuessFieldKey]bool, len(rules.HiddenFields))
	for _, field := range rules.HiddenFields {
		hidden[field] = true
	}
	if hidden[FieldFirstAppearance] {
		normalized.FieldModes[FieldFirstAppearance] = FieldModeHidden
	}
	if hidden[FieldReleaseYear] {
		normalized.FieldModes[FieldReleaseYear] = FieldModeHidden
	}
	if hidden[FieldSpecies] {
		normalized.FieldModes[FieldSpecies] = FieldModeHidden
	}
	if hidden[FieldAffiliations] {
		normalized.FieldModes[FieldAffiliations] = FieldModeHidden
	}
	if hidden[FieldLocations] {
		normalized.FieldModes[FieldLocations] = FieldModeHidden
	}
	if hidden[FieldHairColors] {
		normalized.FieldModes[FieldHairColors] = FieldModeHidden
	}
	if rules.TurnSeconds != nil {
		normalized.TurnLimit.Enabled = true
		normalized.TurnLimit.Seconds = *rules.TurnSeconds
	}
	normalized = normalizeQuestionScopeRules(normalized)
	if custom {
		hideFieldsMissingFromLegacySchema(normalized.FieldModes)
	}
	return normalized
}

func sameQuestionScopeRules(left, right QuestionScopeRules) bool {
	left = normalizeQuestionScopeRules(left)
	right = normalizeQuestionScopeRules(right)
	return sameFieldModes(left.FieldModes, right.FieldModes) &&
		left.TurnLimit.Enabled == right.TurnLimit.Enabled &&
		(!left.TurnLimit.Enabled || left.TurnLimit.Seconds == right.TurnLimit.Seconds) &&
		left.GuessLimit.Enabled == right.GuessLimit.Enabled &&
		left.GuessLimit.MaxGuesses == right.GuessLimit.MaxGuesses
}

func sameFieldModes(left, right map[GuessFieldKey]string) bool {
	if len(left) != len(right) {
		return false
	}
	for key, mode := range left {
		if right[key] != mode {
			return false
		}
	}
	return true
}

func sameIds(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func inferDifficulty(
	selectedCharacterIds []string,
	rules QuestionScopeRules,
	characters []Character,
	preferredPreset QuestionDifficulty,
) QuestionDifficulty {
	matchesPreset := func(preset QuestionDifficulty) bool {
		return sameIds(selectedCharacterIds, PresetQuestionScopeIDs(preset, characters)) &&
			sameQuestionScopeRules(rules, PresetQuestionScopeRules(preset))
	}
	if IsQuestionDifficultyPreset(preferredPreset) && matchesPreset(preferredPreset) {
		return preferredPreset
	}
	for _, definition := range questionScopePresetDefinitions {
		preset := definition.Difficulty
		if matchesPreset(preset) {
			return preset
		}
	}
	return QuestionDifficultyCustom
}

func FieldsForQuestionScope(config QuestionScopeConfig) []GuessField {
	rules := normalizeQuestionScopeRules(config.Rules)
	return CharacterFields.FieldsForModes(rules.FieldModes)
}

func StorageFieldsForQuestionScope(config QuestionScopeConfig) []GuessField {
	rules := normalizeQuestionScopeRules(config.Rules)
	storageModes := CharacterFields.DefaultFieldModes()
	if rules.FieldModes[FieldReleaseYear] == FieldModeExactOnly {
		storageModes[FieldReleaseYear] = FieldModeExactOnly
	}
	return CharacterFields.FieldsForModes(storageModes)
}

func QuestionScopeAnswerPool(config QuestionScopeConfig) []string {
	return append([]string{}, config.SelectedCharacterIDs...)
}

func canonicalQuestionScope(catalogVersion string, works []QuestionScopeWork, characters []Character, selectedIDs []string, rules QuestionScopeRules, preferredPreset QuestionDifficulty) QuestionScopeConfig {
	selectedIDs = normalizeQuestionScopeIDs(selectedIDs, characters)
	rules = normalizeQuestionScopeRules(rules)
	difficulty := inferDifficulty(selectedIDs, rules, characters, preferredPreset)
	mode := QuestionScopeModePreset
	if difficulty == QuestionDifficultyCustom {
		mode = QuestionScopeModeCustom
	}
	return QuestionScopeConfig{
		SchemaVersion:        QuestionScopeSchemaVersion,
		CatalogVersion:       catalogVersion,
		Mode:                 mode,
		Difficulty:           difficulty,
		SelectedCharacterIDs: selectedIDs,
		WorkStates:           BuildQuestionScopeWorkStates(works, characters, selectedIDs),
		Rules:                rules,
	}
}

func BuildQuestionScopeWorkStates(works []QuestionScopeWork, characters []Character, selectedIDs []string) []QuestionScopeWorkState {
	selected := map[string]bool{}
	for _, id := range selectedIDs {
		selected[id] = true
	}
	type counts struct {
		selected int
		total    int
	}
	byWork := map[string]counts{}
	for _, character := range characters {
		if !character.EnabledAsAnswer {
			continue
		}
		current := byWork[character.FirstAppearance.WorkID]
		current.total++
		if selected[character.ID] {
			current.selected++
		}
		byWork[character.FirstAppearance.WorkID] = current
	}
	states := make([]QuestionScopeWorkState, 0, len(works))
	for _, work := range works {
		current := byWork[work.ID]
		state := QuestionScopeWorkNone
		if current.total > 0 && current.selected == current.total {
			state = QuestionScopeWorkAll
		} else if current.selected > 0 {
			state = QuestionScopeWorkPartial
		}
		states = append(states, QuestionScopeWorkState{
			WorkID:        work.ID,
			State:         state,
			SelectedCount: current.selected,
			TotalCount:    current.total,
		})
	}
	return states
}

func normalizeQuestionScopeIDs(ids []string, characters []Character) []string {
	selected := map[string]bool{}
	for _, id := range ids {
		selected[id] = true
	}
	pool := make([]Character, 0, len(characters))
	for _, character := range characters {
		if character.EnabledAsAnswer && selected[character.ID] {
			pool = append(pool, character)
		}
	}
	sort.Slice(pool, func(i, j int) bool {
		if pool[i].AppearanceOrder == pool[j].AppearanceOrder {
			return pool[i].ID < pool[j].ID
		}
		return pool[i].AppearanceOrder < pool[j].AppearanceOrder
	})
	out := make([]string, 0, len(pool))
	seen := map[string]bool{}
	for _, character := range pool {
		if !seen[character.ID] {
			out = append(out, character.ID)
			seen[character.ID] = true
		}
	}
	return out
}

func NormalizeQuestionScope(input *QuestionScopeConfig, catalogVersion string, works []QuestionScopeWork, characters []Character) QuestionScopeCorrection {
	if input == nil {
		return QuestionScopeCorrection{Config: DefaultQuestionScope(catalogVersion, works, characters, QuestionDifficultyNormal), Changed: true}
	}

	requestedPreset := QuestionDifficulty("")
	if IsQuestionDifficultyPreset(input.Difficulty) {
		requestedPreset = input.Difficulty
	}

	missingMode := ""
	if input.Mode == QuestionScopeModeCustom {
		missingMode = FieldModeHidden
	}
	rules := normalizeQuestionScopeRules(input.Rules)
	if len(input.Rules.FieldModes) > 0 {
		rules.FieldModes = normalizeQuestionScopeFieldModes(input.Rules, missingMode)
	}
	if input.SchemaVersion < QuestionScopeSchemaVersion {
		rules = legacyQuestionScopeRules(input.Rules, requestedPreset, input.SchemaVersion, input.Mode == QuestionScopeModeCustom)
	}

	incoming := input.SelectedCharacterIDs
	if input.CatalogVersion != catalogVersion && input.Mode == QuestionScopeModePreset && requestedPreset != "" {
		incoming = PresetQuestionScopeIDs(requestedPreset, characters)
	} else if len(incoming) == 0 && requestedPreset != "" {
		incoming = PresetQuestionScopeIDs(requestedPreset, characters)
	}
	selected := normalizeQuestionScopeIDs(incoming, characters)
	reason := ""
	if len(selected) == 0 {
		selected = PresetQuestionScopeIDs(QuestionDifficultyNormal, characters)
		rules = PresetQuestionScopeRules(QuestionDifficultyNormal)
		requestedPreset = QuestionDifficultyNormal
		reason = "empty-pool-fallback"
	} else if len(selected) != len(incoming) {
		reason = "invalid-ids-dropped"
	}

	config := canonicalQuestionScope(catalogVersion, works, characters, selected, rules, requestedPreset)
	changed := input.CatalogVersion != catalogVersion ||
		input.SchemaVersion != QuestionScopeSchemaVersion ||
		input.Mode != config.Mode ||
		input.Difficulty != config.Difficulty ||
		!sameIds(input.SelectedCharacterIDs, config.SelectedCharacterIDs) ||
		!sameQuestionScopeRules(input.Rules, config.Rules)
	if reason == "" && input.CatalogVersion != catalogVersion {
		reason = "catalog-updated"
	}
	return QuestionScopeCorrection{Config: config, Changed: changed, Reason: reason}
}
