package handler

import (
	"encoding/json"
	"fmt"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
)

// characterFromRow 将行表记录还原为 game.Character（jsonb 字段解码）。
func characterFromRow(row repo.Character) (game.Character, error) {
	var names game.LocalizedNames
	if err := json.Unmarshal(row.Names, &names); err != nil {
		return game.Character{}, fmt.Errorf("decode names for %s: %w", row.ID, err)
	}
	var firstAppearance game.FirstAppearance
	if err := json.Unmarshal(row.FirstAppearance, &firstAppearance); err != nil {
		return game.Character{}, fmt.Errorf("decode firstAppearance for %s: %w", row.ID, err)
	}
	decode := func(raw []byte, target any) error { return json.Unmarshal(raw, target) }
	var species, abilityTags, affiliations, locations, roles, hairColors, sourceRefs []string
	if err := decode(row.Species, &species); err != nil {
		return game.Character{}, err
	}
	if err := decode(row.AbilityTags, &abilityTags); err != nil {
		return game.Character{}, err
	}
	if err := decode(row.Affiliations, &affiliations); err != nil {
		return game.Character{}, err
	}
	if err := decode(row.Locations, &locations); err != nil {
		return game.Character{}, err
	}
	if err := decode(row.Roles, &roles); err != nil {
		return game.Character{}, err
	}
	if err := decode(row.HairColors, &hairColors); err != nil {
		return game.Character{}, err
	}
	if err := decode(row.SourceRefs, &sourceRefs); err != nil {
		return game.Character{}, err
	}
	return game.Character{
		ID:              row.ID,
		AvatarURL:       row.AvatarUrl,
		Names:           names,
		FirstAppearance: firstAppearance,
		Species:         species,
		AbilityDisplay:  row.AbilityDisplay,
		AbilityTags:     abilityTags,
		Affiliations:    affiliations,
		Locations:       locations,
		Roles:           roles,
		HairColors:      hairColors,
		Playable:        row.Playable,
		EnabledAsAnswer: row.EnabledAsAnswer,
		EnabledAsGuess:  row.EnabledAsGuess,
		DifficultyTier:  row.DifficultyTier,
		SourceRefs:      sourceRefs,
		AppearanceOrder: int(row.AppearanceOrder),
	}, nil
}

// snapshotCharacters 从快照 jsonb 还原角色列表。
func snapshotCharacters(snapshot repo.CatalogSnapshot) ([]game.Character, error) {
	var characters []game.Character
	if err := json.Unmarshal(snapshot.Characters, &characters); err != nil {
		return nil, fmt.Errorf("decode snapshot %s: %w", snapshot.Version, err)
	}
	return characters, nil
}

func toOpenAPICharacter(character game.Character) openapi.Character {
	hairColors := make([]openapi.HairColor, 0, len(character.HairColors))
	for _, color := range character.HairColors {
		hairColors = append(hairColors, openapi.HairColor(color))
	}
	firstAppearance := openapi.FirstAppearance{
		WorkId:      character.FirstAppearance.WorkID,
		WorkTitle:   character.FirstAppearance.WorkTitle,
		WorkType:    openapi.WorkType(character.FirstAppearance.WorkType),
		ReleaseYear: character.FirstAppearance.ReleaseYear,
	}
	if character.FirstAppearance.MainlineIndex != nil {
		index := *character.FirstAppearance.MainlineIndex
		firstAppearance.MainlineIndex = &index
	}
	if character.FirstAppearance.Era != nil {
		era := openapi.Era(*character.FirstAppearance.Era)
		firstAppearance.Era = &era
	}
	return openapi.Character{
		Id:              character.ID,
		AvatarUrl:       character.AvatarURL,
		Names:           openapi.LocalizedNames{ZhHans: character.Names.ZhHans, ZhHant: character.Names.ZhHant, Ja: character.Names.Ja, En: character.Names.En, Romaji: character.Names.Romaji, Aliases: character.Names.Aliases},
		FirstAppearance: firstAppearance,
		Species:         character.Species,
		AbilityDisplay:  character.AbilityDisplay,
		AbilityTags:     character.AbilityTags,
		Affiliations:    character.Affiliations,
		Locations:       character.Locations,
		Roles:           character.Roles,
		HairColors:      hairColors,
		Playable:        character.Playable,
		EnabledAsAnswer: character.EnabledAsAnswer,
		EnabledAsGuess:  character.EnabledAsGuess,
		DifficultyTier:  openapi.DifficultyTier(character.DifficultyTier),
		SourceRefs:      character.SourceRefs,
		AppearanceOrder: character.AppearanceOrder,
	}
}

// toSearchResult 对应 shared 的 toSearchResult。
func toSearchResult(character game.Character) openapi.CharacterSearchResult {
	hairColors := make([]openapi.HairColor, 0, len(character.HairColors))
	for _, color := range character.HairColors {
		hairColors = append(hairColors, openapi.HairColor(color))
	}
	runes := []rune(character.Names.ZhHans)
	initials := string(runes)
	if len(runes) > 2 {
		initials = string(runes[:2])
	}
	return openapi.CharacterSearchResult{
		Id:              character.ID,
		Name:            character.Names.ZhHans,
		Subtitle:        character.Names.En + " · " + character.FirstAppearance.WorkTitle,
		Initials:        initials,
		AvatarUrl:       character.AvatarURL,
		AppearanceOrder: character.AppearanceOrder,
		FirstAppearance: struct {
			ReleaseYear int    `json:"releaseYear"`
			WorkTitle   string `json:"workTitle"`
		}{
			ReleaseYear: character.FirstAppearance.ReleaseYear,
			WorkTitle:   character.FirstAppearance.WorkTitle,
		},
		Species:      character.Species,
		Locations:    character.Locations,
		Affiliations: character.Affiliations,
		HairColors:   hairColors,
	}
}

func toOpenAPIGuessResult(result game.GuessResult) openapi.GuessResult {
	feedback := make([]openapi.FieldFeedback, 0, len(result.Feedback))
	for _, field := range result.Feedback {
		feedback = append(feedback, openapi.FieldFeedback{
			Field:        openapi.GuessFieldKey(field.Field),
			Label:        field.Label,
			Status:       openapi.FeedbackStatus(field.Status),
			Symbol:       openapi.FeedbackSymbol(field.Symbol),
			DisplayValue: field.DisplayValue,
		})
	}
	var avatarURL *string
	if result.GuessAvatarURL != "" {
		avatarURL = &result.GuessAvatarURL
	}
	return openapi.GuessResult{
		GuessId:        result.GuessID,
		GuessName:      result.GuessName,
		GuessAvatarUrl: avatarURL,
		IsCorrect:      result.IsCorrect,
		Feedback:       feedback,
	}
}

// hydrateGuessAvatars 对应 db.ts 的 hydrateGuessAvatars：为旧猜测补充头像。
func hydrateGuessAvatars(guesses []game.GuessResult, characters []game.Character) []openapi.GuessResult {
	avatarsByID := make(map[string]string, len(characters))
	for _, character := range characters {
		avatarsByID[character.ID] = character.AvatarURL
	}
	results := make([]openapi.GuessResult, 0, len(guesses))
	for _, guess := range guesses {
		converted := toOpenAPIGuessResult(guess)
		if converted.GuessAvatarUrl == nil {
			if avatar, ok := avatarsByID[guess.GuessID]; ok {
				converted.GuessAvatarUrl = &avatar
			}
		}
		results = append(results, converted)
	}
	return results
}

// toPublicSession 对应 db.ts 的 toPublicSession。
func toPublicSession(session repo.GameSession, characters []game.Character) (openapi.PublicGameSession, error) {
	var guesses []game.GuessResult
	if err := json.Unmarshal(session.Guesses, &guesses); err != nil {
		return openapi.PublicGameSession{}, fmt.Errorf("decode guesses for %s: %w", session.ID, err)
	}
	hydrated := hydrateGuessAvatars(guesses, characters)

	result := openapi.PublicGameSession{
		Id:          session.ID,
		Mode:        openapi.GameMode(session.Mode),
		ContentType: openapi.GameContentType(session.ContentType),
		Status:      openapi.SessionStatus(session.Status),
		MaxGuesses:  int(session.MaxGuesses),
		Guesses:     hydrated,
		StartedAt:   session.StartedAt.Time,
	}
	if session.PuzzleKey.Valid {
		result.PuzzleKey = &session.PuzzleKey.String
	}
	if session.EndedAt.Valid {
		result.EndedAt = &session.EndedAt.Time
	}
	if session.Status != string(game.SessionPlaying) {
		var answer *game.Character
		for i := range characters {
			if characters[i].ID == session.AnswerID {
				answer = &characters[i]
				break
			}
		}
		if answer == nil {
			return openapi.PublicGameSession{}, fmt.Errorf(
				"answer %s is missing from catalog %s", session.AnswerID, session.CatalogVersion)
		}
		converted := toOpenAPICharacter(*answer)
		result.Answer = &converted
	}
	return result, nil
}
