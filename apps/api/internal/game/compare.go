package game

import (
	"strconv"
)

// HairColorLabel 对应 shared 的 HAIR_COLOR_LABELS。
var HairColorLabels = map[string]string{
	"black":     "黑",
	"brown":     "棕",
	"blonde":    "金",
	"white":     "白",
	"silver":    "银",
	"red":       "红",
	"pink":      "粉",
	"purple":    "紫",
	"blue":      "蓝",
	"green":     "绿",
	"orange":    "橙",
	"gray":      "灰",
	"multicolor": "多色",
	"other":     "其他",
}

// CHARACTER_GUESS_FIELDS 对应 shared 的 CHARACTER_GUESS_FIELDS。
var CharacterGuessFields = []GuessField{
	{Key: FieldFirstAppearance, Label: "初登场作品", Type: "hierarchy", Visible: true, CompareStrategy: "firstAppearance", HelpText: "具体作品相同为命中，同类媒介为部分匹配。"},
	{Key: FieldReleaseYear, Label: "初登场年份", Type: "number", Visible: true, CompareStrategy: "numberDirection", HelpText: "箭头指向答案所在年份。"},
	{Key: FieldSpecies, Label: "种族", Type: "multi_enum", Visible: true, CompareStrategy: "multiSet"},
	{Key: FieldAffiliations, Label: "阵营", Type: "multi_enum", Visible: true, CompareStrategy: "multiSet"},
	{Key: FieldLocations, Label: "地点", Type: "multi_enum", Visible: true, CompareStrategy: "multiSet"},
	{Key: FieldHairColors, Label: "头发颜色", Type: "multi_enum", Visible: true, CompareStrategy: "multiSet"},
}

// GameContentDefinition 对应 shared 的 GAME_CONTENT_DEFINITIONS.character。
var GameContentDefinition = struct {
	Label      string
	MaxGuesses int
	Fields     []GuessField
}{
	Label:      "角色",
	MaxGuesses: 8,
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

func sameSet(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	rightSet := make(map[string]struct{}, len(right))
	for _, item := range right {
		rightSet[item] = struct{}{}
	}
	for _, item := range left {
		if _, ok := rightSet[item]; !ok {
			return false
		}
	}
	return true
}

func hasIntersection(left, right []string) bool {
	rightSet := make(map[string]struct{}, len(right))
	for _, item := range right {
		rightSet[item] = struct{}{}
	}
	for _, item := range left {
		if _, ok := rightSet[item]; ok {
			return true
		}
	}
	return false
}

func compareMultiSet(guessValues, answerValues []string) FeedbackStatus {
	if len(guessValues) == 0 || len(answerValues) == 0 {
		return FeedbackUnknown
	}
	if sameSet(guessValues, answerValues) {
		return FeedbackExact
	}
	if hasIntersection(guessValues, answerValues) {
		return FeedbackPartial
	}
	return FeedbackMiss
}

// displayValuesForField 返回展示用值（发色为中文标签，年份为字符串）。
func DisplayValuesForField(character Character, field GuessFieldKey) []string {
	switch field {
	case FieldFirstAppearance:
		return []string{character.FirstAppearance.WorkTitle}
	case FieldReleaseYear:
		return []string{itoa(character.FirstAppearance.ReleaseYear)}
	case FieldHairColors:
		labels := make([]string, 0, len(character.HairColors))
		for _, color := range character.HairColors {
			labels = append(labels, HairColorLabels[color])
		}
		return labels
	default:
		return characterFieldValues(character, field)
	}
}

// valuesForField 返回比较用值（首登场为作品 id，年份为字符串）。
func valuesForField(character Character, field GuessFieldKey) []string {
	switch field {
	case FieldFirstAppearance:
		return []string{character.FirstAppearance.WorkID}
	case FieldReleaseYear:
		return []string{itoa(character.FirstAppearance.ReleaseYear)}
	default:
		return characterFieldValues(character, field)
	}
}

func characterFieldValues(character Character, field GuessFieldKey) []string {
	switch field {
	case FieldSpecies:
		return character.Species
	case FieldAbilityTags:
		return character.AbilityTags
	case FieldAffiliations:
		return character.Affiliations
	case FieldLocations:
		return character.Locations
	case FieldRoles:
		return character.Roles
	case FieldHairColors:
		return character.HairColors
	default:
		return nil
	}
}

func itoa(value int) string {
	return strconv.Itoa(value)
}

// CompareField 对应 shared 的 compareField。
func CompareField(guess, answer Character, field GuessField) FieldFeedback {
	status := FeedbackUnknown

	switch field.CompareStrategy {
	case "firstAppearance":
		if guess.FirstAppearance.WorkID == answer.FirstAppearance.WorkID {
			status = FeedbackExact
		} else if guess.FirstAppearance.WorkType == answer.FirstAppearance.WorkType {
			status = FeedbackPartial
		} else {
			status = FeedbackMiss
		}
	case "numberDirection":
		guessYear := guess.FirstAppearance.ReleaseYear
		answerYear := answer.FirstAppearance.ReleaseYear
		if guessYear == answerYear {
			status = FeedbackExact
		} else if guessYear < answerYear {
			status = FeedbackHigher
		} else {
			status = FeedbackLower
		}
	case "multiSet":
		status = compareMultiSet(
			valuesForField(guess, field.Key),
			valuesForField(answer, field.Key),
		)
	}

	return FieldFeedback{
		Field:        field.Key,
		Label:        field.Label,
		Status:       status,
		Symbol:       StatusToSymbol(status),
		DisplayValue: DisplayValuesForField(guess, field.Key),
	}
}

// CompareCharacter 对应 shared 的 compareCharacter。
func CompareCharacter(guess, answer Character, fields []GuessField) GuessResult {
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
		GuessID:        guess.ID,
		GuessName:      guess.Names.ZhHans,
		GuessAvatarURL: guess.AvatarURL,
		IsCorrect:      guess.ID == answer.ID,
		Feedback:       feedback,
	}
}