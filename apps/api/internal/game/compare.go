package game

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

// CompareField 对应 shared 的 compareField。
func CompareField(guess, answer Character, field GuessField) FieldFeedback {
	status := CharacterFields.CompareFeedback(guess, answer, field)

	return FieldFeedback{
		Field:        field.Key,
		Label:        field.Label,
		Status:       status,
		Symbol:       StatusToSymbol(status),
		DisplayValue: DisplayValuesForField(guess, field.Key),
	}
}

func CompareCharacterWithMatch(guess, answer Character, fields []GuessField, match MatchResult) GuessResult {
	if fields == nil {
		fields = CharacterGuessFields
	}
	feedback := make([]FieldFeedback, 0, len(fields))
	for _, field := range fields {
		if field.Visible {
			feedback = append(feedback, CompareField(guess, answer, field))
		}
	}
	return GuessResult{
		Kind:           "guess",
		GuessID:        guess.ID,
		GuessName:      guess.Names.ZhHans,
		GuessAvatarURL: guess.AvatarURL,
		IsCorrect:      match.Correct,
		MatchKind:      match.Kind,
		Feedback:       feedback,
	}
}

// CompareCharacter preserves strict identity semantics while callers migrate to GuessEvaluator.
func CompareCharacter(guess, answer Character, fields []GuessField) GuessResult {
	return CompareCharacterWithMatch(guess, answer, fields, StrictIdentityMatcher{}.Match(nil, answer.ID, guess.ID))
}
