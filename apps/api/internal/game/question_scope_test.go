package game_test

import (
	"reflect"
	"testing"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
)

func questionScopeCharacter(id, difficultyTier string, appearanceOrder int) game.Character {
	return game.Character{
		ID:              id,
		DifficultyTier:  difficultyTier,
		AppearanceOrder: appearanceOrder,
		EnabledAsAnswer: true,
		EnabledAsGuess:  true,
		FirstAppearance: game.FirstAppearance{WorkID: "work"},
	}
}

func TestPresetQuestionScopeRulesHardTurnLimit(t *testing.T) {
	rules := game.PresetQuestionScopeRules(game.QuestionDifficultyHard)

	if !rules.TurnLimit.Enabled {
		t.Fatal("hard preset should enable the per-turn limit")
	}
	if rules.TurnLimit.Seconds != 45 {
		t.Fatalf("hard turn limit = %d, want 45", rules.TurnLimit.Seconds)
	}
	if rules.FieldModes[game.FieldFirstAppearance] == game.FieldModeHidden {
		t.Fatal("hard preset should keep first appearance visible")
	}
}

func TestNormalizeQuestionScopeRulesAllowsOneGuess(t *testing.T) {
	rules := game.NormalizeQuestionScopeRules(game.QuestionScopeRules{
		GuessLimit: game.QuestionScopeGuessLimit{Enabled: true, MaxGuesses: 1},
	})

	if rules.GuessLimit.MaxGuesses != 1 {
		t.Fatalf("guess limit = %d, want 1", rules.GuessLimit.MaxGuesses)
	}
}

func TestNormalizeCustomQuestionScopeHidesMissingAndInvalidModes(t *testing.T) {
	characters := []game.Character{questionScopeCharacter("one", "easy", 1)}
	scope := game.QuestionScopeConfig{
		SchemaVersion:        game.QuestionScopeSchemaVersion,
		CatalogVersion:       "catalog",
		Mode:                 game.QuestionScopeModeCustom,
		Difficulty:           game.QuestionDifficultyCustom,
		SelectedCharacterIDs: []string{"one"},
		Rules: game.QuestionScopeRules{
			FieldModes: map[game.GuessFieldKey]string{
				game.FieldSpecies:     game.FieldModeDefault,
				game.FieldReleaseYear: "not-a-mode",
			},
			GuessLimit: game.QuestionScopeGuessLimit{Enabled: true, MaxGuesses: 8},
		},
	}

	normalized := game.NormalizeQuestionScope(&scope, "catalog", nil, characters).Config.Rules.FieldModes
	if normalized[game.FieldSpecies] != game.FieldModeDefault {
		t.Fatalf("explicit species mode = %q, want default", normalized[game.FieldSpecies])
	}
	for _, definition := range game.CharacterFields.Definitions() {
		if definition.Key != game.FieldSpecies && normalized[definition.Key] != game.FieldModeHidden {
			t.Fatalf("custom missing or invalid mode for %s = %q, want hidden", definition.Key, normalized[definition.Key])
		}
	}
}

func TestNormalizeLegacyV2QuestionScopeUsesFixedFields(t *testing.T) {
	characters := []game.Character{questionScopeCharacter("one", "easy", 1)}
	scope := game.QuestionScopeConfig{
		SchemaVersion:        2,
		CatalogVersion:       "catalog",
		Mode:                 game.QuestionScopeModeCustom,
		Difficulty:           game.QuestionDifficultyCustom,
		SelectedCharacterIDs: []string{"one"},
		Rules: game.QuestionScopeRules{
			Fields: &game.QuestionScopeFieldRules{
				FirstAppearance: true,
				ReleaseYear:     game.QuestionScopeReleaseYearExactOnly,
				Species:         false,
				Affiliations:    true,
				Locations:       false,
				HairColors:      true,
			},
			TurnLimit:  game.QuestionScopeTurnLimit{Enabled: true, Seconds: 60},
			GuessLimit: game.QuestionScopeGuessLimit{Enabled: true, MaxGuesses: 4},
		},
	}

	normalized := game.NormalizeQuestionScope(&scope, "catalog", nil, characters).Config.Rules
	if normalized.FieldModes[game.FieldReleaseYear] != game.FieldModeExactOnly ||
		normalized.FieldModes[game.FieldSpecies] != game.FieldModeHidden ||
		normalized.FieldModes[game.FieldAffiliations] != game.FieldModeDefault {
		t.Fatalf("legacy v2 field modes = %+v", normalized.FieldModes)
	}
	if normalized.TurnLimit.Seconds != 60 || normalized.GuessLimit.MaxGuesses != 4 {
		t.Fatalf("legacy v2 limits = turn %+v, guess %+v", normalized.TurnLimit, normalized.GuessLimit)
	}
}

func TestExtraQuestionScopePreset(t *testing.T) {
	characters := []game.Character{
		questionScopeCharacter("easy", "easy", 1),
		questionScopeCharacter("normal", "normal", 2),
		questionScopeCharacter("hard", "hard", 3),
		questionScopeCharacter("lunatic", "lunatic", 4),
		questionScopeCharacter("extra", "extra", 5),
	}
	want := []string{"easy", "normal", "hard", "lunatic", "extra"}

	if !game.IsQuestionDifficultyPreset(game.QuestionDifficultyExtra) {
		t.Fatal("extra should be recognized as a question scope preset")
	}
	if ids := game.PresetQuestionScopeIDs(game.QuestionDifficultyExtra, characters); !reflect.DeepEqual(ids, want) {
		t.Fatalf("extra ids = %v, want %v", ids, want)
	}
	rules := game.PresetQuestionScopeRules(game.QuestionDifficultyExtra)
	if rules.FieldModes[game.FieldFirstAppearance] != game.FieldModeHidden {
		t.Fatal("extra preset should hide first appearance")
	}
	if !rules.GuessLimit.Enabled || rules.GuessLimit.MaxGuesses != 8 {
		t.Fatalf("extra guess limit = %+v, want enabled with 8 guesses", rules.GuessLimit)
	}
	if !rules.TurnLimit.Enabled || rules.TurnLimit.Seconds != 30 {
		t.Fatalf("extra turn limit = %+v, want enabled with 30 seconds", rules.TurnLimit)
	}
}

func TestQuestionScopePresetPoolsAreCumulative(t *testing.T) {
	characters := []game.Character{
		questionScopeCharacter("easy", "easy", 1),
		questionScopeCharacter("normal", "normal", 2),
		questionScopeCharacter("hard", "hard", 3),
		questionScopeCharacter("lunatic", "lunatic", 4),
		questionScopeCharacter("extra", "extra", 5),
	}

	testCases := []struct {
		preset game.QuestionDifficulty
		want   []string
	}{
		{game.QuestionDifficultyEasy, []string{"easy"}},
		{game.QuestionDifficultyNormal, []string{"easy", "normal"}},
		{game.QuestionDifficultyHard, []string{"easy", "normal", "hard"}},
		{game.QuestionDifficultyLunatic, []string{"easy", "normal", "hard", "lunatic"}},
		{game.QuestionDifficultyExtra, []string{"easy", "normal", "hard", "lunatic", "extra"}},
	}

	for _, testCase := range testCases {
		if ids := game.PresetQuestionScopeIDs(testCase.preset, characters); !reflect.DeepEqual(ids, testCase.want) {
			t.Fatalf("%s ids = %v, want %v", testCase.preset, ids, testCase.want)
		}
	}
}

func TestExtraPresetIdentityBeforeExtraDataExists(t *testing.T) {
	characters := []game.Character{
		questionScopeCharacter("easy", "easy", 1),
		questionScopeCharacter("normal", "normal", 2),
		questionScopeCharacter("hard", "hard", 3),
		questionScopeCharacter("lunatic", "lunatic", 4),
	}

	scope := game.DefaultQuestionScope("without-extra", nil, characters, game.QuestionDifficultyExtra)
	if scope.Difficulty != game.QuestionDifficultyExtra {
		t.Fatalf("default difficulty = %s, want extra", scope.Difficulty)
	}
	correction := game.NormalizeQuestionScope(&scope, "without-extra", nil, characters)
	if correction.Config.Difficulty != game.QuestionDifficultyExtra {
		t.Fatalf("normalized difficulty = %s, want extra", correction.Config.Difficulty)
	}

	expandedCharacters := append(
		append([]game.Character{}, characters...),
		questionScopeCharacter("extra", "extra", 5),
	)
	correction = game.NormalizeQuestionScope(&scope, "with-extra", nil, expandedCharacters)
	if correction.Config.Difficulty != game.QuestionDifficultyExtra {
		t.Fatalf("expanded difficulty = %s, want extra", correction.Config.Difficulty)
	}
	wantIDs := []string{"easy", "normal", "hard", "lunatic", "extra"}
	if !reflect.DeepEqual(correction.Config.SelectedCharacterIDs, wantIDs) {
		t.Fatalf("expanded ids = %v, want %v", correction.Config.SelectedCharacterIDs, wantIDs)
	}
}

func TestDailyQuestionDifficultiesExcludeExtra(t *testing.T) {
	for _, difficulty := range []game.QuestionDifficulty{
		game.QuestionDifficultyEasy,
		game.QuestionDifficultyNormal,
		game.QuestionDifficultyHard,
		game.QuestionDifficultyLunatic,
	} {
		if !game.IsDailyQuestionDifficulty(difficulty) {
			t.Fatalf("%s should be available for daily questions", difficulty)
		}
	}
	if game.IsDailyQuestionDifficulty(game.QuestionDifficultyExtra) {
		t.Fatal("extra should not be available for daily questions")
	}
}
