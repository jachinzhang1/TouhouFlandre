package game

import "github.com/TouhouFlandre/touhouflandre/apps/api/guessing"

// HairColorLabel 对应 shared 的 HAIR_COLOR_LABELS。
var HairColorLabels = map[string]string{
	"black":      "黑",
	"brown":      "棕",
	"blonde":     "金",
	"white":      "白",
	"silver":     "银",
	"red":        "红",
	"pink":       "粉",
	"purple":     "紫",
	"blue":       "蓝",
	"green":      "绿",
	"orange":     "橙",
	"gray":       "灰",
	"multicolor": "多色",
	"other":      "其他",
	"none":       "无",
}

// CHARACTER_GUESS_FIELDS 对应 shared 的 CHARACTER_GUESS_FIELDS。
var CharacterGuessFields = CharacterFields.AllFields()

// GameContentDefinition 对应 shared 的 GAME_CONTENT_DEFINITIONS.character。
var GameContentDefinition = struct {
	Label      string
	MaxGuesses int
	Fields     []GuessField
}{
	Label:      "角色",
	MaxGuesses: QuestionScopeDefaultGuesses,
	Fields:     CharacterGuessFields,
}

func StatusToSymbol(status FeedbackStatus) string {
	switch status {
	case FeedbackExact:
		return "O"
	case FeedbackPartial:
		return "~"
	case FeedbackHigher:
		return "↑"
	case FeedbackLower:
		return "↓"
	case FeedbackUnknown:
		return "?"
	default:
		return "X"
	}
}

// displayValuesForField 返回展示用值（发色为中文标签，年份为字符串）。
func DisplayValuesForField(character Character, field GuessFieldKey) []string {
	return CharacterFields.DisplayValues(character, field)
}

// CompareField presents the reusable core's semantic comparison.
func CompareField(guess, answer Character, field GuessField) FieldFeedback {
	return presentField(guess, field, CharacterFields.CompareFeedback(guess, answer, field))
}

// CompareCharacterWithMatch preserves the application result shape for callers
// that already hold a match decision. Authoritative guesses use GuessEvaluator.
func CompareCharacterWithMatch(guess, answer Character, fields []GuessField, match MatchResult) GuessResult {
	rules := ruleFields(fields)
	feedback := make([]guessing.FieldFeedback, 0, len(rules))
	for _, field := range rules {
		feedback = append(feedback, guessing.FieldFeedback{
			Field: field.Key, Status: guessing.CompareField(ruleCharacter(guess), ruleCharacter(answer), field),
		})
	}
	return presentGuess(guess, fields, guessing.Result{
		GuessID: guess.ID, IsCorrect: match.Correct, MatchKind: match.Kind, Feedback: feedback,
	})
}
