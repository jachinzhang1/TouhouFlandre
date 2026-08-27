package game

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

const CharacterFieldRegistryVersion = 1

const (
	FieldModeHidden      = "hidden"
	FieldModeDefault     = "default"
	FieldModeExactOnly   = "exactOnly"
	FieldModeDirectional = "directional"
)

type canonicalFieldValue struct {
	StringValue *string  `json:"stringValue,omitempty"`
	NumberValue *int     `json:"numberValue,omitempty"`
	SetValue    []string `json:"setValue,omitempty"`
}

type characterFieldRegistration struct {
	definition      GuessFieldDefinition
	defaultStrategy string
	canonicalValue  func(Character) (canonicalFieldValue, bool)
	displayValues   func(Character) []string
	compareFeedback func(Character, Character, string) FeedbackStatus
}

type CharacterFieldRegistry struct {
	version     int
	ordered     []characterFieldRegistration
	byKey       map[GuessFieldKey]characterFieldRegistration
	equivalence []characterFieldRegistration
}

func stringValue(value string) (canonicalFieldValue, bool) {
	if !knownString(value) {
		return canonicalFieldValue{}, false
	}
	return canonicalFieldValue{StringValue: &value}, true
}

func knownString(value string) bool {
	trimmed := strings.TrimSpace(value)
	return trimmed != "" && !strings.EqualFold(trimmed, "unknown") && trimmed != "未知"
}

func numberValue(value int) (canonicalFieldValue, bool) {
	if value == 0 {
		return canonicalFieldValue{}, false
	}
	return canonicalFieldValue{NumberValue: &value}, true
}

func setValue(values []string) (canonicalFieldValue, bool) {
	if len(values) == 0 {
		return canonicalFieldValue{}, false
	}
	normalized := append([]string{}, values...)
	sort.Strings(normalized)
	deduplicated := normalized[:0]
	for _, value := range normalized {
		if !knownString(value) {
			return canonicalFieldValue{}, false
		}
		if len(deduplicated) == 0 || deduplicated[len(deduplicated)-1] != value {
			deduplicated = append(deduplicated, value)
		}
	}
	return canonicalFieldValue{SetValue: deduplicated}, true
}

func firstAppearanceFeedback(guess, answer Character, _ string) FeedbackStatus {
	if _, ok := stringValue(guess.FirstAppearance.WorkID); !ok {
		return FeedbackUnknown
	}
	if _, ok := stringValue(answer.FirstAppearance.WorkID); !ok {
		return FeedbackUnknown
	}
	if guess.FirstAppearance.WorkID == answer.FirstAppearance.WorkID {
		return FeedbackExact
	}
	if knownString(guess.FirstAppearance.WorkType) &&
		knownString(answer.FirstAppearance.WorkType) &&
		guess.FirstAppearance.WorkType == answer.FirstAppearance.WorkType {
		return FeedbackPartial
	}
	return FeedbackMiss
}

func releaseYearFeedback(guess, answer Character, strategy string) FeedbackStatus {
	guessYear := guess.FirstAppearance.ReleaseYear
	answerYear := answer.FirstAppearance.ReleaseYear
	if _, ok := numberValue(guessYear); !ok {
		return FeedbackUnknown
	}
	if _, ok := numberValue(answerYear); !ok {
		return FeedbackUnknown
	}
	if guessYear == answerYear {
		return FeedbackExact
	}
	if strategy == "numberExact" {
		return FeedbackMiss
	}
	if guessYear < answerYear {
		return FeedbackHigher
	}
	return FeedbackLower
}

func multiSetFeedback(values func(Character) []string) func(Character, Character, string) FeedbackStatus {
	return func(guess, answer Character, _ string) FeedbackStatus {
		guessValue, guessOK := setValue(values(guess))
		answerValue, answerOK := setValue(values(answer))
		if !guessOK || !answerOK {
			return FeedbackUnknown
		}
		if slicesEqual(guessValue.SetValue, answerValue.SetValue) {
			return FeedbackExact
		}
		answerSet := make(map[string]struct{}, len(answerValue.SetValue))
		for _, value := range answerValue.SetValue {
			answerSet[value] = struct{}{}
		}
		for _, value := range guessValue.SetValue {
			if _, ok := answerSet[value]; ok {
				return FeedbackPartial
			}
		}
		return FeedbackMiss
	}
}

func slicesEqual(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
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
	canonical func(Character) (canonicalFieldValue, bool),
	display func(Character) []string,
	compare func(Character, Character, string) FeedbackStatus,
) characterFieldRegistration {
	return characterFieldRegistration{
		definition: GuessFieldDefinition{
			Key: key, Label: label, Type: fieldType, HelpText: helpText,
			Configurable: true, DefaultMode: defaultMode, Modes: modes, Equivalence: true,
		},
		defaultStrategy: strategy,
		canonicalValue:  canonical,
		displayValues:   display,
		compareFeedback: compare,
	}
}

func newCharacterFieldRegistry() *CharacterFieldRegistry {
	registrations := []characterFieldRegistration{
		publicField(
			FieldFirstAppearance, "初登场作品", "hierarchy", "firstAppearance",
			"具体作品相同为命中，同类媒介为部分匹配。", FieldModeDefault, toggleModes(),
			func(character Character) (canonicalFieldValue, bool) {
				return stringValue(character.FirstAppearance.WorkID)
			},
			func(character Character) []string { return []string{character.FirstAppearance.WorkTitle} },
			firstAppearanceFeedback,
		),
		publicField(
			FieldReleaseYear, "初登场年份", "number", "numberDirection",
			"箭头指向答案所在年份。", FieldModeDirectional,
			[]GuessFieldModeDefinition{
				{Key: FieldModeHidden, Label: "关闭", Enabled: false},
				{Key: FieldModeExactOnly, Label: "仅精确", Enabled: true},
				{Key: FieldModeDirectional, Label: "方向提示", Enabled: true},
			},
			func(character Character) (canonicalFieldValue, bool) {
				return numberValue(character.FirstAppearance.ReleaseYear)
			},
			func(character Character) []string {
				return []string{strconv.Itoa(character.FirstAppearance.ReleaseYear)}
			},
			releaseYearFeedback,
		),
		publicField(
			FieldSpecies, "种族", "multi_enum", "multiSet", "", FieldModeDefault, toggleModes(),
			func(character Character) (canonicalFieldValue, bool) { return setValue(character.Species) },
			func(character Character) []string { return append([]string{}, character.Species...) },
			multiSetFeedback(func(character Character) []string { return character.Species }),
		),
		publicField(
			FieldAffiliations, "阵营", "multi_enum", "multiSet", "", FieldModeDefault, toggleModes(),
			func(character Character) (canonicalFieldValue, bool) { return setValue(character.Affiliations) },
			func(character Character) []string { return append([]string{}, character.Affiliations...) },
			multiSetFeedback(func(character Character) []string { return character.Affiliations }),
		),
		publicField(
			FieldLocations, "地点", "multi_enum", "multiSet", "", FieldModeDefault, toggleModes(),
			func(character Character) (canonicalFieldValue, bool) { return setValue(character.Locations) },
			func(character Character) []string { return append([]string{}, character.Locations...) },
			multiSetFeedback(func(character Character) []string { return character.Locations }),
		),
		publicField(
			FieldHairColors, "头发颜色", "multi_enum", "multiSet", "", FieldModeDefault, toggleModes(),
			func(character Character) (canonicalFieldValue, bool) { return setValue(character.HairColors) },
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
			multiSetFeedback(func(character Character) []string { return character.HairColors }),
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
		if registration.definition.Equivalence {
			registry.equivalence = append(registry.equivalence, registration)
		}
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
	registration, ok := registry.byKey[key]
	if !ok {
		return canonicalFieldValue{}, false
	}
	return registration.canonicalValue(character)
}

func (registry *CharacterFieldRegistry) CompareFeedback(guess, answer Character, field GuessField) FeedbackStatus {
	registration, ok := registry.byKey[field.Key]
	if !ok || registration.compareFeedback == nil {
		return FeedbackUnknown
	}
	return registration.compareFeedback(guess, answer, field.CompareStrategy)
}

func (registry *CharacterFieldRegistry) EquivalenceSignature(character Character) (string, bool) {
	type signatureField struct {
		Key   GuessFieldKey       `json:"key"`
		Value canonicalFieldValue `json:"value"`
	}
	signature := make([]signatureField, 0, len(registry.equivalence))
	for _, registration := range registry.equivalence {
		value, ok := registration.canonicalValue(character)
		if !ok {
			return "", false
		}
		signature = append(signature, signatureField{Key: registration.definition.Key, Value: value})
	}
	encoded, err := json.Marshal(signature)
	if err != nil {
		panic(fmt.Sprintf("game: encode equivalence signature: %v", err))
	}
	return string(encoded), true
}

func (registry *CharacterFieldRegistry) Equivalent(left, right Character) bool {
	leftSignature, leftOK := registry.EquivalenceSignature(left)
	rightSignature, rightOK := registry.EquivalenceSignature(right)
	return leftOK && rightOK && leftSignature == rightSignature
}
