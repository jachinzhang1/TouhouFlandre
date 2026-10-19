package game

import (
	"strconv"

	"github.com/TouhouFlandre/touhouflandre/apps/api/guessing"
)

const CharacterFieldRegistryVersion = 1

const (
	FieldModeHidden      = "hidden"
	FieldModeDefault     = "default"
	FieldModeExactOnly   = "exactOnly"
	FieldModeDirectional = "directional"
)

type canonicalFieldValue = guessing.CanonicalFieldValue

// Field registration owns product configuration and display metadata. Semantic
// comparison and canonicalization are implemented only in package guessing.
type characterFieldRegistration struct {
	definition      GuessFieldDefinition
	defaultStrategy string
	displayValues   func(Character) []string
}

type CharacterFieldRegistry struct {
	version int
	ordered []characterFieldRegistration
	byKey   map[GuessFieldKey]characterFieldRegistration
}

func toggleModes() []GuessFieldModeDefinition {
	return []GuessFieldModeDefinition{
		{Key: FieldModeHidden, Label: "关闭", Enabled: false},
		{Key: FieldModeDefault, Label: "开启", Enabled: true},
	}
}

func publicField(
	key GuessFieldKey,
	label string,
	fieldType string,
	strategy string,
	helpText string,
	defaultMode string,
	modes []GuessFieldModeDefinition,
	display func(Character) []string,
) characterFieldRegistration {
	return characterFieldRegistration{
		definition: GuessFieldDefinition{
			Key: key, Label: label, Type: fieldType, HelpText: helpText,
			Configurable: true, DefaultMode: defaultMode, Modes: modes, Equivalence: true,
		},
		defaultStrategy: strategy,
		displayValues:   display,
	}
}

func newCharacterFieldRegistry() *CharacterFieldRegistry {
	registrations := []characterFieldRegistration{
		publicField(
			FieldFirstAppearance, "初登场作品", "hierarchy", "firstAppearance",
			"具体作品相同为命中，同类媒介为部分匹配。", FieldModeDefault, toggleModes(),
			func(character Character) []string { return []string{character.FirstAppearance.WorkTitle} },
		),
		publicField(
			FieldReleaseYear, "初登场年份", "number", "numberDirection",
			"箭头指向答案所在年份。", FieldModeDirectional,
			[]GuessFieldModeDefinition{
				{Key: FieldModeHidden, Label: "关闭", Enabled: false},
				{Key: FieldModeExactOnly, Label: "仅精确", Enabled: true},
				{Key: FieldModeDirectional, Label: "方向提示", Enabled: true},
			},
			func(character Character) []string {
				return []string{strconv.Itoa(character.FirstAppearance.ReleaseYear)}
			},
		),
		publicField(
			FieldSpecies, "种族", "multi_enum", "multiSet", "", FieldModeDefault, toggleModes(),
			func(character Character) []string { return append([]string{}, character.Species...) },
		),
		publicField(
			FieldAffiliations, "阵营", "multi_enum", "multiSet", "", FieldModeDefault, toggleModes(),
			func(character Character) []string { return append([]string{}, character.Affiliations...) },
		),
		publicField(
			FieldLocations, "地点", "multi_enum", "multiSet", "", FieldModeDefault, toggleModes(),
			func(character Character) []string { return append([]string{}, character.Locations...) },
		),
		publicField(
			FieldHairColors, "头发颜色", "multi_enum", "multiSet", "", FieldModeDefault, toggleModes(),
			func(character Character) []string {
				labels := make([]string, 0, len(character.HairColors))
				for _, color := range character.HairColors {
					if label, ok := HairColorLabels[color]; ok {
						labels = append(labels, label)
					} else {
						labels = append(labels, color)
					}
				}
				return labels
			},
		),
	}
	registry := &CharacterFieldRegistry{
		version: CharacterFieldRegistryVersion,
		ordered: registrations,
		byKey:   make(map[GuessFieldKey]characterFieldRegistration, len(registrations)),
	}
	for _, registration := range registrations {
		if _, duplicate := registry.byKey[registration.definition.Key]; duplicate {
			panic("game: duplicate character field registration: " + registration.definition.Key)
		}
		registry.byKey[registration.definition.Key] = registration
	}
	return registry
}

var CharacterFields = newCharacterFieldRegistry()

func (registry *CharacterFieldRegistry) Version() int { return registry.version }

func (registry *CharacterFieldRegistry) Definitions() []GuessFieldDefinition {
	definitions := make([]GuessFieldDefinition, 0, len(registry.ordered))
	for _, registration := range registry.ordered {
		definition := registration.definition
		definition.Modes = append([]GuessFieldModeDefinition{}, definition.Modes...)
		definitions = append(definitions, definition)
	}
	return definitions
}

func (registry *CharacterFieldRegistry) DefaultFieldModes() map[GuessFieldKey]string {
	modes := make(map[GuessFieldKey]string, len(registry.ordered))
	for _, registration := range registry.ordered {
		modes[registration.definition.Key] = registration.definition.DefaultMode
	}
	return modes
}

func (registry *CharacterFieldRegistry) FieldModeValid(key GuessFieldKey, mode string) bool {
	registration, ok := registry.byKey[key]
	if !ok {
		return false
	}
	for _, candidate := range registration.definition.Modes {
		if candidate.Key == mode {
			return true
		}
	}
	return false
}

func (registry *CharacterFieldRegistry) GuessField(key GuessFieldKey, mode string) (GuessField, bool) {
	registration, ok := registry.byKey[key]
	if !ok || !registry.FieldModeValid(key, mode) || mode == FieldModeHidden {
		return GuessField{}, false
	}
	strategy := registration.defaultStrategy
	if key == FieldReleaseYear && mode == FieldModeExactOnly {
		strategy = "numberExact"
	}
	return GuessField{
		Key: key, Label: registration.definition.Label, Type: registration.definition.Type,
		Visible: true, CompareStrategy: strategy, HelpText: registration.definition.HelpText,
	}, true
}

func (registry *CharacterFieldRegistry) FieldsForModes(modes map[GuessFieldKey]string) []GuessField {
	fields := make([]GuessField, 0, len(registry.ordered))
	for _, registration := range registry.ordered {
		mode := modes[registration.definition.Key]
		if field, ok := registry.GuessField(registration.definition.Key, mode); ok {
			fields = append(fields, field)
		}
	}
	return fields
}

func (registry *CharacterFieldRegistry) AllFields() []GuessField {
	return registry.FieldsForModes(registry.DefaultFieldModes())
}

func (registry *CharacterFieldRegistry) DisplayValues(character Character, key GuessFieldKey) []string {
	registration, ok := registry.byKey[key]
	if !ok {
		return nil
	}
	return registration.displayValues(character)
}

func (registry *CharacterFieldRegistry) CanonicalValue(character Character, key GuessFieldKey) (canonicalFieldValue, bool) {
	return guessing.CanonicalValue(ruleCharacter(character), key)
}

func (registry *CharacterFieldRegistry) CompareFeedback(guess, answer Character, field GuessField) FeedbackStatus {
	return guessing.CompareField(ruleCharacter(guess), ruleCharacter(answer), guessing.FieldRule{
		Key: field.Key, CompareStrategy: field.CompareStrategy,
	})
}

func (registry *CharacterFieldRegistry) EquivalenceSignature(character Character) (string, bool) {
	return guessing.EquivalenceSignature(ruleCharacter(character))
}

func (registry *CharacterFieldRegistry) Equivalent(left, right Character) bool {
	leftSignature, leftOK := registry.EquivalenceSignature(left)
	rightSignature, rightOK := registry.EquivalenceSignature(right)
	return leftOK && rightOK && leftSignature == rightSignature
}
