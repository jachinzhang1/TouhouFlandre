package handler

import (
	"context"
	"encoding/json"
	"sort"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
)

func questionScopeWorks(rows []repo.Work) []game.QuestionScopeWork {
	works := make([]game.QuestionScopeWork, 0, len(rows))
	for _, row := range rows {
		works = append(works, game.QuestionScopeWork{ID: row.ID})
	}
	return works
}

func questionScopeWorksForSnapshot(rows []repo.Work, characters []game.Character) []game.QuestionScopeWork {
	if len(rows) > 0 {
		return questionScopeWorks(rows)
	}
	sorted := append([]game.Character{}, characters...)
	sort.Slice(sorted, func(i, j int) bool {
		if sorted[i].AppearanceOrder == sorted[j].AppearanceOrder {
			return sorted[i].ID < sorted[j].ID
		}
		return sorted[i].AppearanceOrder < sorted[j].AppearanceOrder
	})
	seen := map[string]bool{}
	works := make([]game.QuestionScopeWork, 0)
	for _, character := range sorted {
		workID := character.FirstAppearance.WorkID
		if workID == "" || seen[workID] {
			continue
		}
		works = append(works, game.QuestionScopeWork{ID: workID})
		seen[workID] = true
	}
	return works
}

func (s *Server) currentCatalogWithWorks(ctx context.Context) (string, []game.Character, []repo.Work, error) {
	version, characters, err := s.getCurrentCatalog(ctx)
	if err != nil {
		return "", nil, nil, err
	}
	works, err := s.q.ListWorks(ctx)
	if err != nil {
		return "", nil, nil, internalError(err)
	}
	return version, characters, works, nil
}

func normalizeQuestionScopeForCatalog(input *game.QuestionScopeConfig, version string, characters []game.Character, works []repo.Work) game.QuestionScopeCorrection {
	return game.NormalizeQuestionScope(input, version, questionScopeWorksForSnapshot(works, characters), characters)
}

func questionScopeFromOpenAPI(input *openapi.QuestionScopeConfig) *game.QuestionScopeConfig {
	if input == nil {
		return nil
	}
	return &game.QuestionScopeConfig{
		SchemaVersion:        int(input.SchemaVersion),
		CatalogVersion:       input.CatalogVersion,
		Mode:                 game.QuestionScopeMode(input.Mode),
		Difficulty:           game.QuestionDifficulty(input.Difficulty),
		SelectedCharacterIDs: append([]string{}, input.SelectedCharacterIds...),
		WorkStates:           questionScopeWorkStatesFromOpenAPI(input.WorkStates),
		Rules:                questionScopeRulesFromOpenAPI(input.Rules),
	}
}

func questionScopeRulesFromOpenAPI(input openapi.QuestionScopeRules) game.QuestionScopeRules {
	hiddenFields := []game.GuessFieldKey{}
	if input.HiddenFields != nil {
		hiddenFields = make([]game.GuessFieldKey, 0, len(*input.HiddenFields))
		for _, field := range *input.HiddenFields {
			hiddenFields = append(hiddenFields, game.GuessFieldKey(field))
		}
	}
	return game.QuestionScopeRules{
		Fields: game.QuestionScopeFieldRules{
			FirstAppearance: input.Fields.FirstAppearance,
			ReleaseYear:     game.QuestionScopeReleaseYearMode(input.Fields.ReleaseYear),
			Species:         input.Fields.Species,
			Affiliations:    input.Fields.Affiliations,
			Locations:       input.Fields.Locations,
			HairColors:      input.Fields.HairColors,
		},
		TurnLimit: game.QuestionScopeTurnLimit{
			Enabled: input.TurnLimit.Enabled,
			Seconds: input.TurnLimit.Seconds,
		},
		HiddenFields: hiddenFields,
		TurnSeconds:  input.TurnSeconds,
	}
}

func questionScopeWorkStatesFromOpenAPI(input []openapi.QuestionScopeWorkState) []game.QuestionScopeWorkState {
	states := make([]game.QuestionScopeWorkState, 0, len(input))
	for _, state := range input {
		states = append(states, game.QuestionScopeWorkState{
			WorkID:        state.WorkId,
			State:         game.QuestionScopeWorkSelection(state.State),
			SelectedCount: state.SelectedCount,
			TotalCount:    state.TotalCount,
		})
	}
	return states
}

func toOpenAPIQuestionScope(config game.QuestionScopeConfig) openapi.QuestionScopeConfig {
	return openapi.QuestionScopeConfig{
		SchemaVersion:        openapi.QuestionScopeConfigSchemaVersion(config.SchemaVersion),
		CatalogVersion:       config.CatalogVersion,
		Mode:                 openapi.QuestionScopeMode(config.Mode),
		Difficulty:           openapi.QuestionDifficulty(config.Difficulty),
		SelectedCharacterIds: append([]string{}, config.SelectedCharacterIDs...),
		WorkStates:           toOpenAPIQuestionScopeWorkStates(config.WorkStates),
		Rules:                toOpenAPIQuestionScopeRules(config.Rules),
	}
}

func toOpenAPIQuestionScopeRules(rules game.QuestionScopeRules) openapi.QuestionScopeRules {
	return openapi.QuestionScopeRules{
		Fields: openapi.QuestionScopeFieldRules{
			FirstAppearance: rules.Fields.FirstAppearance,
			ReleaseYear:     openapi.QuestionScopeReleaseYearMode(rules.Fields.ReleaseYear),
			Species:         rules.Fields.Species,
			Affiliations:    rules.Fields.Affiliations,
			Locations:       rules.Fields.Locations,
			HairColors:      rules.Fields.HairColors,
		},
		TurnLimit: openapi.QuestionScopeTurnLimit{
			Enabled: rules.TurnLimit.Enabled,
			Seconds: rules.TurnLimit.Seconds,
		},
	}
}

func toOpenAPIQuestionScopeWorkStates(states []game.QuestionScopeWorkState) []openapi.QuestionScopeWorkState {
	out := make([]openapi.QuestionScopeWorkState, 0, len(states))
	for _, state := range states {
		out = append(out, openapi.QuestionScopeWorkState{
			WorkId:        state.WorkID,
			State:         openapi.QuestionScopeWorkSelection(state.State),
			SelectedCount: state.SelectedCount,
			TotalCount:    state.TotalCount,
		})
	}
	return out
}

func questionScopeJSON(config game.QuestionScopeConfig) ([]byte, error) {
	return jsonMarshal(config)
}

func questionScopeFromJSON(data []byte, catalogVersion string, works []repo.Work, characters []game.Character) (game.QuestionScopeConfig, error) {
	if len(data) == 0 {
		return game.DefaultQuestionScope(catalogVersion, questionScopeWorksForSnapshot(works, characters), characters, game.QuestionDifficultyHard), nil
	}
	var config game.QuestionScopeConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return game.QuestionScopeConfig{}, err
	}
	return normalizeQuestionScopeForCatalog(&config, catalogVersion, characters, works).Config, nil
}

func storedQuestionScopeFromJSON(data []byte) (game.QuestionScopeConfig, error) {
	var config game.QuestionScopeConfig
	if len(data) == 0 {
		return config, nil
	}
	if err := json.Unmarshal(data, &config); err != nil {
		return game.QuestionScopeConfig{}, err
	}
	return config, nil
}
