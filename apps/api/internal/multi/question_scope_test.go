package multi

import (
	"encoding/json"
	"testing"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
)

func TestValidateStoredStatusesUsesStorageFieldWidth(t *testing.T) {
	scope := game.QuestionScopeConfig{
		SchemaVersion: game.QuestionScopeSchemaVersion,
		Mode:          game.QuestionScopeModeCustom,
		Rules: game.QuestionScopeRules{FieldModes: map[game.GuessFieldKey]string{
			game.FieldFirstAppearance: game.FieldModeHidden,
			game.FieldReleaseYear:     game.FieldModeDirectional,
			game.FieldSpecies:         game.FieldModeDefault,
			game.FieldAffiliations:    game.FieldModeDefault,
			game.FieldLocations:       game.FieldModeDefault,
			game.FieldHairColors:      game.FieldModeDefault,
		}},
	}
	scopeJSON, err := json.Marshal(scope)
	if err != nil {
		t.Fatal(err)
	}
	match := repo.MultiMatch{QuestionScope: scopeJSON}

	if got := len(FieldsForMatch(match)); got != 5 {
		t.Fatalf("visible field width = %d, want 5", got)
	}
	storageWidth := len(StorageFieldsForMatch(match))
	if storageWidth != len(game.CharacterGuessFields) {
		t.Fatalf("storage field width = %d, want %d", storageWidth, len(game.CharacterGuessFields))
	}
	statuses := make([]string, storageWidth)
	for index := range statuses {
		statuses[index] = string(game.FeedbackMiss)
	}
	if err := ValidateStoredStatuses(match, statuses); err != nil {
		t.Fatalf("validate storage-width statuses: %v", err)
	}
	if err := ValidateStoredStatuses(match, statuses[:len(statuses)-1]); err == nil {
		t.Fatal("visible-width statuses unexpectedly passed storage validation")
	}
	statuses[0] = "invalid"
	if err := ValidateStoredStatuses(match, statuses); err == nil {
		t.Fatal("invalid feedback status unexpectedly passed validation")
	}
}
