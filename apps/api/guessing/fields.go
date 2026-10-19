package guessing

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// CanonicalFieldValue is a known field value used in equivalence signatures.
// Exactly one member is populated. SetValue is sorted and deduplicated.
type CanonicalFieldValue struct {
	StringValue *string  `json:"stringValue,omitempty"`
	NumberValue *int     `json:"numberValue,omitempty"`
	SetValue    []string `json:"setValue,omitempty"`
}

// DefaultFields returns a fresh slice containing the six public field rules.
// These six attributes also define public_fields_v1 answer equivalence.
func DefaultFields() []FieldRule {
	return []FieldRule{
		{Key: FieldFirstAppearance, CompareStrategy: "firstAppearance"},
		{Key: FieldReleaseYear, CompareStrategy: "numberDirection"},
		{Key: FieldSpecies, CompareStrategy: "multiSet"},
		{Key: FieldAffiliations, CompareStrategy: "multiSet"},
		{Key: FieldLocations, CompareStrategy: "multiSet"},
		{Key: FieldHairColors, CompareStrategy: "multiSet"},
	}
}

func knownString(value string) bool {
	trimmed := strings.TrimSpace(value)
	return trimmed != "" && !strings.EqualFold(trimmed, "unknown") && trimmed != "未知"
}

func stringValue(value string) (CanonicalFieldValue, bool) {
	if !knownString(value) {
		return CanonicalFieldValue{}, false
	}
	return CanonicalFieldValue{StringValue: &value}, true
}

func numberValue(value int) (CanonicalFieldValue, bool) {
	if value == 0 {
		return CanonicalFieldValue{}, false
	}
	return CanonicalFieldValue{NumberValue: &value}, true
}

func setValue(values []string) (CanonicalFieldValue, bool) {
	if len(values) == 0 {
		return CanonicalFieldValue{}, false
	}
	normalized := append([]string{}, values...)
	sort.Strings(normalized)
	deduplicated := normalized[:0]
	for _, value := range normalized {
		if !knownString(value) {
			return CanonicalFieldValue{}, false
		}
		if len(deduplicated) == 0 || deduplicated[len(deduplicated)-1] != value {
			deduplicated = append(deduplicated, value)
		}
	}
	return CanonicalFieldValue{SetValue: deduplicated}, true
}

// CanonicalValue returns a copy of the field's canonical value. Missing and
// unknown values, and unsupported keys, return false. Known strings retain
// their original spelling; only set order and duplicate entries are normalized.
func CanonicalValue(character Character, key FieldKey) (CanonicalFieldValue, bool) {
	switch key {
	case FieldFirstAppearance:
		return stringValue(character.FirstAppearance.WorkID)
	case FieldReleaseYear:
		return numberValue(character.FirstAppearance.ReleaseYear)
	case FieldSpecies:
		return setValue(character.Species)
	case FieldAffiliations:
		return setValue(character.Affiliations)
	case FieldLocations:
		return setValue(character.Locations)
	case FieldHairColors:
		return setValue(character.HairColors)
	default:
		return CanonicalFieldValue{}, false
	}
}

// CompareField compares a single field. Higher and lower point from the guess
// toward the answer. Missing values and unsupported fields return unknown.
func CompareField(guess, answer Character, field FieldRule) FeedbackStatus {
	guessValue, guessOK := CanonicalValue(guess, field.Key)
	answerValue, answerOK := CanonicalValue(answer, field.Key)
	if !guessOK || !answerOK {
		return FeedbackUnknown
	}
	switch field.Key {
	case FieldFirstAppearance:
		if *guessValue.StringValue == *answerValue.StringValue {
			return FeedbackExact
		}
		if knownString(guess.FirstAppearance.WorkType) &&
			knownString(answer.FirstAppearance.WorkType) &&
			guess.FirstAppearance.WorkType == answer.FirstAppearance.WorkType {
			return FeedbackPartial
		}
		return FeedbackMiss
	case FieldReleaseYear:
		if *guessValue.NumberValue == *answerValue.NumberValue {
			return FeedbackExact
		}
		if field.CompareStrategy == "numberExact" {
			return FeedbackMiss
		}
		if *guessValue.NumberValue < *answerValue.NumberValue {
			return FeedbackHigher
		}
		return FeedbackLower
	default:
		return compareSets(guessValue.SetValue, answerValue.SetValue)
	}
}

func compareSets(guess, answer []string) FeedbackStatus {
	equal := len(guess) == len(answer)
	if equal {
		for index := range guess {
			if guess[index] != answer[index] {
				equal = false
				break
			}
		}
	}
	if equal {
		return FeedbackExact
	}
	answerSet := make(map[string]struct{}, len(answer))
	for _, value := range answer {
		answerSet[value] = struct{}{}
	}
	for _, value := range guess {
		if _, ok := answerSet[value]; ok {
			return FeedbackPartial
		}
	}
	return FeedbackMiss
}

// EquivalenceSignature encodes all six public_fields_v1 attributes in their
// stable order. Any unknown attribute makes the signature unavailable. The
// feedback fields requested by a caller never change answer equivalence.
func EquivalenceSignature(character Character) (string, bool) {
	type signatureField struct {
		Key   FieldKey            `json:"key"`
		Value CanonicalFieldValue `json:"value"`
	}
	fields := DefaultFields()
	signature := make([]signatureField, 0, len(fields))
	for _, field := range fields {
		value, ok := CanonicalValue(character, field.Key)
		if !ok {
			return "", false
		}
		signature = append(signature, signatureField{Key: field.Key, Value: value})
	}
	encoded, err := json.Marshal(signature)
	if err != nil {
		panic(fmt.Sprintf("guessing: encode equivalence signature: %v", err))
	}
	return string(encoded), true
}
