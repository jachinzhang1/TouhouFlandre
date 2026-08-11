package multi

import (
	"encoding/json"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
)

func QuestionScopeForMatch(match repo.MultiMatch) (game.QuestionScopeConfig, bool) {
	if len(match.QuestionScope) == 0 {
		return game.QuestionScopeConfig{}, false
	}
	var scope game.QuestionScopeConfig
	if err := json.Unmarshal(match.QuestionScope, &scope); err != nil {
		return game.QuestionScopeConfig{}, false
	}
	return scope, true
}

func MaxGuessesForMatch(match repo.MultiMatch) int {
	scope, ok := QuestionScopeForMatch(match)
	if !ok {
		return GameMaxGuesses
	}
	maxGuesses := game.EffectiveQuestionScopeMaxGuesses(scope.Rules)
	if maxGuesses <= 0 {
		return GameMaxGuesses
	}
	return maxGuesses
}

func FieldsForMatch(match repo.MultiMatch) []game.GuessField {
	scope, ok := QuestionScopeForMatch(match)
	if !ok {
		return game.CharacterGuessFields
	}
	return game.FieldsForQuestionScope(scope)
}

func StorageFieldsForMatch(match repo.MultiMatch) []game.GuessField {
	scope, ok := QuestionScopeForMatch(match)
	if !ok {
		return game.CharacterGuessFields
	}
	return game.StorageFieldsForQuestionScope(scope)
}

func AnswerPoolForMatch(match repo.MultiMatch, characters []game.Character) []string {
	scope, ok := QuestionScopeForMatch(match)
	if !ok || len(scope.SelectedCharacterIDs) == 0 {
		return AnswerPool(characters)
	}
	return game.QuestionScopeAnswerPool(scope)
}
