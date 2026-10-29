package game

import "github.com/TouhouFlandre/touhouflandre/apps/api/guessing"

// ruleCharacter leaves names, artwork, search and seed metadata outside the
// reusable rules. The catalog wire model is unchanged, including its hash order.
func ruleCharacter(character Character) guessing.Character {
	return guessing.Character{
		ID: character.ID, EnabledAsGuess: character.EnabledAsGuess,
		FirstAppearance: guessing.FirstAppearance{
			WorkID: character.FirstAppearance.WorkID, WorkType: character.FirstAppearance.WorkType,
			ReleaseYear: character.FirstAppearance.ReleaseYear,
		},
		Species: character.Species, Affiliations: character.Affiliations,
		Locations: character.Locations, HairColors: character.HairColors,
	}
}

func ruleFields(fields []GuessField) []guessing.FieldRule {
	if fields == nil {
		fields = CharacterGuessFields
	}
	rules := make([]guessing.FieldRule, 0, len(fields))
	for _, field := range fields {
		if field.Visible {
			rules = append(rules, guessing.FieldRule{Key: field.Key, CompareStrategy: field.CompareStrategy})
		}
	}
	return rules
}

func presentField(guess Character, field GuessField, status FeedbackStatus) FieldFeedback {
	return FieldFeedback{
		Field: field.Key, Label: field.Label, Status: status,
		Symbol: StatusToSymbol(status), DisplayValue: DisplayValuesForField(guess, field.Key),
	}
}

// presentGuess preserves the existing stored and public result format. Rule
// feedback has the same ordered, enabled fields, including repeated field keys.
func presentGuess(guess Character, fields []GuessField, result guessing.Result) GuessResult {
	if fields == nil {
		fields = CharacterGuessFields
	}
	feedback := make([]FieldFeedback, 0, len(result.Feedback))
	for _, field := range fields {
		if field.Visible {
			feedback = append(feedback, presentField(guess, field, result.Feedback[len(feedback)].Status))
		}
	}
	return GuessResult{
		Kind: "guess", GuessID: result.GuessID, GuessName: guess.Names.ZhHans,
		GuessAvatarURL: guess.AvatarURL, IsCorrect: result.IsCorrect,
		MatchKind: result.MatchKind, Feedback: feedback,
	}
}
