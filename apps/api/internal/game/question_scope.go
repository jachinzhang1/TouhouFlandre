package game

import "sort"

const QuestionScopeSchemaVersion = 2

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
	Fields       QuestionScopeFieldRules `json:"fields"`
	TurnLimit    QuestionScopeTurnLimit  `json:"turnLimit"`
	GuessLimit   QuestionScopeGuessLimit `json:"guessLimit"`
	HiddenFields []GuessFieldKey         `json:"hiddenFields,omitempty"`
	TurnSeconds  *int                    `json:"turnSeconds,omitempty"`
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

var questionScopePresets = []QuestionDifficulty{
	QuestionDifficultyEasy,
	QuestionDifficultyNormal,
	QuestionDifficultyHard,
	QuestionDifficultyLunatic,
}

func IsQuestionDifficultyPreset(value QuestionDifficulty) bool {
	switch value {
	case QuestionDifficultyEasy, QuestionDifficultyNormal, QuestionDifficultyHard, QuestionDifficultyLunatic:
		return true
	default:
		return false
	}
}

func PresetQuestionScopeRules(preset QuestionDifficulty) QuestionScopeRules {
	rules := QuestionScopeRules{
		Fields: QuestionScopeFieldRules{
			FirstAppearance: true,
			ReleaseYear:     QuestionScopeReleaseYearDirectional,
			Species:         true,
			Affiliations:    true,
			Locations:       true,
			HairColors:      true,
		},
		TurnLimit: QuestionScopeTurnLimit{
			Enabled: false,
			Seconds: QuestionScopeMinTurnSeconds,
		},
		GuessLimit: QuestionScopeGuessLimit{
			Enabled:    true,
			MaxGuesses: QuestionScopeDefaultGuesses,
		},
	}
	if preset == QuestionDifficultyEasy {
		rules.GuessLimit.Enabled = false
	}
	if preset == QuestionDifficultyHard {
		rules.TurnLimit.Enabled = true
		rules.TurnLimit.Seconds = QuestionScopeHardTurnSeconds
	}
	if preset == QuestionDifficultyLunatic {
		rules.Fields.FirstAppearance = false
		rules.TurnLimit.Enabled = true
		rules.TurnLimit.Seconds = QuestionScopeMinTurnSeconds
	}
	return rules
}

func PresetQuestionScopeIDs(preset QuestionDifficulty, characters []Character) []string {
	pool := make([]Character, 0, len(characters))
	for _, character := range characters {
		if !character.EnabledAsAnswer {
			continue
		}
		switch preset {
		case QuestionDifficultyHard, QuestionDifficultyLunatic:
			pool = append(pool, character)
		case QuestionDifficultyNormal:
			if character.DifficultyTier == "easy" || character.DifficultyTier == "normal" {
				pool = append(pool, character)
			}
		case QuestionDifficultyEasy:
			if character.DifficultyTier == "easy" {
				pool = append(pool, character)
			}
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
	return canonicalQuestionScope(catalogVersion, works, characters, PresetQuestionScopeIDs(preset, characters), PresetQuestionScopeRules(preset))
}

func normalizeQuestionScopeFieldRules(fields QuestionScopeFieldRules) QuestionScopeFieldRules {
	if fields.ReleaseYear != QuestionScopeReleaseYearHidden &&
		fields.ReleaseYear != QuestionScopeReleaseYearExactOnly &&
		fields.ReleaseYear != QuestionScopeReleaseYearDirectional {
		fields.ReleaseYear = QuestionScopeReleaseYearDirectional
	}
	return fields
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
		Fields:       normalizeQuestionScopeFieldRules(rules.Fields),
		TurnLimit:    normalizeQuestionScopeTurnLimit(rules.TurnLimit),
		GuessLimit:   normalizeQuestionScopeGuessLimit(rules.GuessLimit),
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

func legacyQuestionScopeRules(rules QuestionScopeRules, requestedPreset QuestionDifficulty) QuestionScopeRules {
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
		normalized.Fields.FirstAppearance = false
	}
	if hidden[FieldReleaseYear] {
		normalized.Fields.ReleaseYear = QuestionScopeReleaseYearHidden
	}
	if hidden[FieldSpecies] {
		normalized.Fields.Species = false
	}
	if hidden[FieldAffiliations] {
		normalized.Fields.Affiliations = false
	}
	if hidden[FieldLocations] {
		normalized.Fields.Locations = false
	}
	if hidden[FieldHairColors] {
		normalized.Fields.HairColors = false
	}
	if rules.TurnSeconds != nil {
		normalized.TurnLimit.Enabled = true
		normalized.TurnLimit.Seconds = *rules.TurnSeconds
	}
	return normalizeQuestionScopeRules(normalized)
}

func sameQuestionScopeRules(left, right QuestionScopeRules) bool {
	left = normalizeQuestionScopeRules(left)
	right = normalizeQuestionScopeRules(right)
	return left.Fields == right.Fields &&
		left.TurnLimit.Enabled == right.TurnLimit.Enabled &&
		(!left.TurnLimit.Enabled || left.TurnLimit.Seconds == right.TurnLimit.Seconds) &&
		left.GuessLimit.Enabled == right.GuessLimit.Enabled &&
		left.GuessLimit.MaxGuesses == right.GuessLimit.MaxGuesses
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
) QuestionDifficulty {
	for _, preset := range questionScopePresets {
		if sameIds(selectedCharacterIds, PresetQuestionScopeIDs(preset, characters)) &&
			sameQuestionScopeRules(rules, PresetQuestionScopeRules(preset)) {
			return preset
		}
	}
	return QuestionDifficultyCustom
}

func questionScopeFieldVisible(rules QuestionScopeRules, field GuessFieldKey) bool {
	switch field {
	case FieldFirstAppearance:
		return rules.Fields.FirstAppearance
	case FieldReleaseYear:
		return rules.Fields.ReleaseYear != QuestionScopeReleaseYearHidden
	case FieldSpecies:
		return rules.Fields.Species
	case FieldAffiliations:
		return rules.Fields.Affiliations
	case FieldLocations:
		return rules.Fields.Locations
	case FieldHairColors:
		return rules.Fields.HairColors
	default:
		return true
	}
}

func FieldsForQuestionScope(config QuestionScopeConfig) []GuessField {
	rules := normalizeQuestionScopeRules(config.Rules)
	fields := make([]GuessField, 0, len(CharacterGuessFields))
	for _, field := range CharacterGuessFields {
		if !questionScopeFieldVisible(rules, field.Key) {
			continue
		}
		if field.Key == FieldReleaseYear && rules.Fields.ReleaseYear == QuestionScopeReleaseYearExactOnly {
			field.CompareStrategy = "numberExact"
		}
		fields = append(fields, field)
	}
	return fields
}

func StorageFieldsForQuestionScope(config QuestionScopeConfig) []GuessField {
	rules := normalizeQuestionScopeRules(config.Rules)
	fields := make([]GuessField, 0, len(CharacterGuessFields))
	for _, field := range CharacterGuessFields {
		if field.Key == FieldReleaseYear && rules.Fields.ReleaseYear == QuestionScopeReleaseYearExactOnly {
			field.CompareStrategy = "numberExact"
		}
		fields = append(fields, field)
	}
	return fields
}

func QuestionScopeAnswerPool(config QuestionScopeConfig) []string {
	return append([]string{}, config.SelectedCharacterIDs...)
}

func canonicalQuestionScope(catalogVersion string, works []QuestionScopeWork, characters []Character, selectedIDs []string, rules QuestionScopeRules) QuestionScopeConfig {
	selectedIDs = normalizeQuestionScopeIDs(selectedIDs, characters)
	rules = normalizeQuestionScopeRules(rules)
	difficulty := inferDifficulty(selectedIDs, rules, characters)
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

	rules := normalizeQuestionScopeRules(input.Rules)
	if input.SchemaVersion < QuestionScopeSchemaVersion {
		rules = legacyQuestionScopeRules(input.Rules, requestedPreset)
	}

	incoming := input.SelectedCharacterIDs
	if len(incoming) == 0 && requestedPreset != "" {
		incoming = PresetQuestionScopeIDs(requestedPreset, characters)
	}
	selected := normalizeQuestionScopeIDs(incoming, characters)
	reason := ""
	if len(selected) == 0 {
		selected = PresetQuestionScopeIDs(QuestionDifficultyNormal, characters)
		rules = PresetQuestionScopeRules(QuestionDifficultyNormal)
		reason = "empty-pool-fallback"
	} else if len(selected) != len(incoming) {
		reason = "invalid-ids-dropped"
	}

	config := canonicalQuestionScope(catalogVersion, works, characters, selected, rules)
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
