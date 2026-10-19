package game_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
)

// This fixture was captured from the original game evaluator before extracting
// the reusable package. Its names, labels, symbols, values, ordering, and empty
// arrays are part of the existing API contract, not the new core's API.
func TestGuessEvaluatorCompatibility(t *testing.T) {
	answer := game.Character{
		ID: "answer", AvatarURL: "/avatars/answer.webp", Names: game.LocalizedNames{ZhHans: "答案角色"},
		FirstAppearance: game.FirstAppearance{WorkID: "work", WorkTitle: "原作", WorkType: "game", ReleaseYear: 2000},
		Species:         []string{"妖怪", "魔法使"}, Affiliations: []string{"红魔馆"},
		Locations: []string{"幻想乡"}, HairColors: []string{"red", "blue"},
		EnabledAsAnswer: true, EnabledAsGuess: true,
	}
	equivalent := answer
	equivalent.ID, equivalent.AvatarURL, equivalent.Names.ZhHans = "equivalent", "/avatars/equivalent.webp", "等价角色"
	equivalent.Species, equivalent.HairColors = []string{"魔法使", "妖怪", "妖怪"}, []string{"blue", "red"}
	different := answer
	different.ID, different.Names.ZhHans = "different", "隐藏字段不同角色"
	different.Locations = []string{"其他地点"}
	partial := answer
	partial.ID, partial.Names.ZhHans = "partial", "部分匹配角色"
	partial.FirstAppearance.WorkID, partial.FirstAppearance.WorkTitle, partial.FirstAppearance.ReleaseYear = "other-work", "另一作品", 1999
	partial.Species, partial.Affiliations, partial.HairColors = []string{"妖怪", "人类"}, []string{"其他阵营"}, []string{"red", "unmapped-color"}
	later := answer
	later.ID, later.Names.ZhHans, later.FirstAppearance.ReleaseYear = "later", "较晚角色", 2001
	unknown := answer
	unknown.ID, unknown.AvatarURL, unknown.Names.ZhHans = "unknown", "", "未知角色"
	unknown.FirstAppearance = game.FirstAppearance{WorkID: " UNKNOWN ", WorkTitle: "未知作品", ReleaseYear: 0}
	unknown.Species, unknown.Affiliations, unknown.Locations, unknown.HairColors = nil, []string{}, []string{"未知"}, []string{"unknown"}
	unknownTwin := unknown
	unknownTwin.ID = "unknown-twin"
	disabled := answer
	disabled.ID, disabled.EnabledAsGuess = "disabled", false
	characters := []game.Character{answer, equivalent, different, partial, later, unknown, unknownTwin, disabled}

	species := game.GuessField{Key: game.FieldSpecies, Label: "种族", Type: "multi_enum", Visible: true, CompareStrategy: "multiSet"}
	yearDirection := game.GuessField{Key: game.FieldReleaseYear, Label: "初登场年份", Type: "number", Visible: true, CompareStrategy: "numberDirection"}
	yearExact := yearDirection
	yearExact.CompareStrategy = "numberExact"
	hiddenLocation := game.GuessField{Key: game.FieldLocations, Label: "地点", Type: "multi_enum", Visible: false, CompareStrategy: "multiSet"}
	tests := []struct {
		name   string
		policy game.AnswerMatchPolicy
		answer string
		guess  string
		fields []game.GuessField
		err    error
	}{
		{name: "exact-default-fields", policy: game.AnswerMatchStrict, answer: "answer", guess: "answer"},
		{name: "strict-rejects-equivalent", policy: game.AnswerMatchStrict, answer: "answer", guess: "equivalent", fields: []game.GuessField{species}},
		{name: "public-fields-equivalent", policy: game.AnswerMatchPublicFieldsV1, answer: "answer", guess: "equivalent"},
		{name: "hidden-field-does-not-expand-equivalence", policy: game.AnswerMatchPublicFieldsV1, answer: "answer", guess: "different", fields: []game.GuessField{species, hiddenLocation}},
		{name: "explicit-empty-fields", policy: game.AnswerMatchStrict, answer: "answer", guess: "answer", fields: []game.GuessField{}},
		{name: "partial-and-miss-default-fields", policy: game.AnswerMatchStrict, answer: "answer", guess: "partial"},
		{name: "year-direction-lower", policy: game.AnswerMatchStrict, answer: "answer", guess: "later", fields: []game.GuessField{yearDirection}},
		{name: "year-exact-only-miss", policy: game.AnswerMatchStrict, answer: "answer", guess: "partial", fields: []game.GuessField{yearExact}},
		{name: "unknown-default-fields", policy: game.AnswerMatchStrict, answer: "answer", guess: "unknown"},
		{name: "unknown-characters-not-equivalent", policy: game.AnswerMatchPublicFieldsV1, answer: "unknown", guess: "unknown-twin", fields: []game.GuessField{species}},
		{name: "unregistered-field", policy: game.AnswerMatchStrict, answer: "answer", guess: "answer", fields: []game.GuessField{{Key: game.FieldAbilityTags, Label: "自定义提示", Visible: true}}},
		{name: "guess-missing", policy: game.AnswerMatchStrict, answer: "answer", guess: "missing", err: game.ErrGuessCharacterMissing},
		{name: "guess-disabled", policy: game.AnswerMatchStrict, answer: "answer", guess: "disabled", err: game.ErrGuessCharacterDisabled},
		{name: "answer-missing", policy: game.AnswerMatchStrict, answer: "missing", guess: "answer", err: game.ErrAnswerCharacterMissing},
	}
	type outcome struct {
		Result *game.GuessResult `json:"result,omitempty"`
		Error  string            `json:"error,omitempty"`
	}
	provider := game.NewCatalogRuntimeProvider(func(context.Context, string) ([]game.Character, error) { return characters, nil })
	evaluator := game.NewGuessEvaluator(provider)
	actual := make(map[string]json.RawMessage, len(tests))
	for _, tc := range tests {
		result, err := evaluator.Evaluate(context.Background(), "compatibility", tc.policy, tc.answer, tc.guess, tc.fields)
		if !errors.Is(err, tc.err) {
			t.Fatalf("%s: error = %v, want %v", tc.name, err, tc.err)
		}
		got := outcome{Result: &result}
		if err != nil {
			got = outcome{Error: err.Error()}
		}
		encoded, err := json.Marshal(got)
		if err != nil {
			t.Fatal(err)
		}
		actual[tc.name] = encoded
	}
	fixture, err := os.ReadFile("testdata/guessing-compatibility.json")
	if err != nil {
		t.Fatal(err)
	}
	var expected map[string]json.RawMessage
	if err := json.Unmarshal(fixture, &expected); err != nil {
		t.Fatal(err)
	}
	if len(expected) != len(tests) {
		t.Fatalf("fixture contains %d cases, want %d", len(expected), len(tests))
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var compact bytes.Buffer
			if err := json.Compact(&compact, expected[tc.name]); err != nil {
				t.Fatalf("invalid or missing baseline: %v", err)
			}
			if !bytes.Equal(actual[tc.name], compact.Bytes()) {
				t.Errorf("observable guess result changed\ngot:  %s\nwant: %s", actual[tc.name], compact.Bytes())
			}
		})
	}
}
