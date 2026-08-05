// Package seed 从 packages/data 题库 JSON 重建 Postgres 中的快照与行表。
package seed

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
)

// sourceWork 对应 packages/data 的 works.demo.json（workSchema 解析结果）。
type sourceWork struct {
	ID            string  `json:"id"`
	TitleZh       string  `json:"titleZh"`
	TitleJa       string  `json:"titleJa"`
	TitleEn       *string `json:"titleEn,omitempty"`
	ShortName     string  `json:"shortName"`
	Type          string  `json:"type"`
	ReleaseYear   int     `json:"releaseYear"`
	MainlineIndex *int    `json:"mainlineIndex,omitempty"`
	Era           *string `json:"era,omitempty"`
}

// sourceCharacter 对应 characters.demo.json 的源形态（firstAppearance 只含 workId）。
type sourceCharacter struct {
	ID              string               `json:"id"`
	AvatarURL       string               `json:"avatarUrl"`
	Names           game.LocalizedNames  `json:"names"`
	FirstAppearance struct {
		WorkID string `json:"workId"`
	} `json:"firstAppearance"`
	Species         []string `json:"species"`
	AbilityDisplay  string   `json:"abilityDisplay"`
	AbilityTags     []string `json:"abilityTags"`
	Affiliations    []string `json:"affiliations"`
	Locations       []string `json:"locations"`
	Roles           []string `json:"roles"`
	HairColors      []string `json:"hairColors"`
	Playable        bool     `json:"playable"`
	EnabledAsAnswer bool     `json:"enabledAsAnswer"`
	EnabledAsGuess  bool     `json:"enabledAsGuess"`
	DifficultyTier  string   `json:"difficultyTier"`
	SourceRefs      []string `json:"sourceRefs"`
}

var avatarOrderPattern = regexp.MustCompile(`^/characters/(\d{4})-[^/]+\.png$`)

func appearanceOrder(avatarURL string) (int, error) {
	match := avatarOrderPattern.FindStringSubmatch(avatarURL)
	if match == nil {
		return 0, fmt.Errorf("avatar URL does not contain a four-digit order: %s", avatarURL)
	}
	return strconv.Atoi(match[1])
}

func loadWorks(path string) ([]sourceWork, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read works: %w", err)
	}
	var works []sourceWork
	if err := json.Unmarshal(data, &works); err != nil {
		return nil, fmt.Errorf("parse works: %w", err)
	}
	return works, nil
}

func loadCharacters(path string, works []sourceWork) ([]game.Character, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read characters: %w", err)
	}
	var sources []sourceCharacter
	if err := json.Unmarshal(data, &sources); err != nil {
		return nil, fmt.Errorf("parse characters: %w", err)
	}

	worksByID := make(map[string]sourceWork, len(works))
	for _, work := range works {
		worksByID[work.ID] = work
	}

	characters := make([]game.Character, 0, len(sources))
	for _, source := range sources {
		work, ok := worksByID[source.FirstAppearance.WorkID]
		if !ok {
			return nil, fmt.Errorf("%s references missing work %s", source.ID, source.FirstAppearance.WorkID)
		}
		order, err := appearanceOrder(source.AvatarURL)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", source.ID, err)
		}
		character := game.Character{
			ID:              source.ID,
			AvatarURL:       source.AvatarURL,
			Names:           source.Names,
			Species:         source.Species,
			AbilityDisplay:  source.AbilityDisplay,
			AbilityTags:     source.AbilityTags,
			Affiliations:    source.Affiliations,
			Locations:       source.Locations,
			Roles:           source.Roles,
			HairColors:      source.HairColors,
			Playable:        source.Playable,
			EnabledAsAnswer: source.EnabledAsAnswer,
			EnabledAsGuess:  source.EnabledAsGuess,
			DifficultyTier:  source.DifficultyTier,
			SourceRefs:      source.SourceRefs,
			FirstAppearance: game.FirstAppearance{
				WorkID:        work.ID,
				WorkTitle:     work.TitleZh,
				WorkType:      work.Type,
				ReleaseYear:   work.ReleaseYear,
				MainlineIndex: work.MainlineIndex,
				Era:           work.Era,
			},
			AppearanceOrder: order,
		}
		characters = append(characters, character)
	}
	return characters, nil
}

// computeCatalogVersion 对应 packages/data 的 demoCatalogVersion：
// FNV-1a(JSON.stringify({ works, characters }))，十六进制 8 位。
func computeCatalogVersion(works []sourceWork, characters []game.Character) string {
	payload := struct {
		Works      []sourceWork     `json:"works"`
		Characters []game.Character `json:"characters"`
	}{works, characters}
	data, err := json.Marshal(payload)
	if err != nil {
		panic(fmt.Sprintf("marshal catalog for versioning: %v", err))
	}
	return fmt.Sprintf("%08x", game.HashString(string(data)))
}

func characterIDs(characters []game.Character) []string {
	ids := make([]string, 0, len(characters))
	for _, character := range characters {
		ids = append(ids, character.ID)
	}
	return ids
}

func workIDs(works []sourceWork) []string {
	ids := make([]string, 0, len(works))
	for _, work := range works {
		ids = append(ids, work.ID)
	}
	return ids
}

func textPtr(value *string) pgtype.Text {
	if value == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *value, Valid: true}
}

func intPtr(value *int) pgtype.Int4 {
	if value == nil {
		return pgtype.Int4{}
	}
	return pgtype.Int4{Int32: int32(*value), Valid: true}
}

// Run 从 dataDir 读取题库 JSON，重建行表、快照与当前版本。
// 返回 catalog 版本号。
func Run(ctx context.Context, pool *pgxpool.Pool, dataDir string) (string, error) {
	works, err := loadWorks(filepath.Join(dataDir, "works.demo.json"))
	if err != nil {
		return "", err
	}
	characters, err := loadCharacters(filepath.Join(dataDir, "characters.demo.json"), works)
	if err != nil {
		return "", err
	}
	version := computeCatalogVersion(works, characters)

	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := repo.New(tx)

	for _, work := range works {
		params := repo.UpsertWorkParams{
			ID:            work.ID,
			TitleZh:       work.TitleZh,
			TitleJa:       work.TitleJa,
			TitleEn:       textPtr(work.TitleEn),
			ShortName:     work.ShortName,
			Type:          work.Type,
			ReleaseYear:   int32(work.ReleaseYear),
			MainlineIndex: intPtr(work.MainlineIndex),
			Era:           textPtr(work.Era),
		}
		if err := q.UpsertWork(ctx, params); err != nil {
			return "", fmt.Errorf("upsert work %s: %w", work.ID, err)
		}
	}
	for _, character := range characters {
		names, err := json.Marshal(character.Names)
		if err != nil {
			return "", err
		}
		firstAppearance, err := json.Marshal(character.FirstAppearance)
		if err != nil {
			return "", err
		}
		species, err := json.Marshal(character.Species)
		if err != nil {
			return "", err
		}
		abilityTags, err := json.Marshal(character.AbilityTags)
		if err != nil {
			return "", err
		}
		affiliations, err := json.Marshal(character.Affiliations)
		if err != nil {
			return "", err
		}
		locations, err := json.Marshal(character.Locations)
		if err != nil {
			return "", err
		}
		roles, err := json.Marshal(character.Roles)
		if err != nil {
			return "", err
		}
		hairColors, err := json.Marshal(character.HairColors)
		if err != nil {
			return "", err
		}
		sourceRefs, err := json.Marshal(character.SourceRefs)
		if err != nil {
			return "", err
		}
		params := repo.UpsertCharacterParams{
			ID:                    character.ID,
			AvatarUrl:             character.AvatarURL,
			DisplayName:           character.Names.ZhHans,
			NameSortKey:           game.CharacterNameSortKey(character),
			SearchText:            game.NormalizeSearchText(game.CharacterSearchText(character)),
			AppearanceOrder:       int32(character.AppearanceOrder),
			FirstAppearanceWorkID: character.FirstAppearance.WorkID,
			Names:                 names,
			FirstAppearance:       firstAppearance,
			Species:               species,
			AbilityDisplay:        character.AbilityDisplay,
			AbilityTags:           abilityTags,
			Affiliations:          affiliations,
			Locations:             locations,
			Roles:                 roles,
			HairColors:            hairColors,
			Playable:              character.Playable,
			EnabledAsAnswer:       character.EnabledAsAnswer,
			EnabledAsGuess:        character.EnabledAsGuess,
			DifficultyTier:        character.DifficultyTier,
			SourceRefs:            sourceRefs,
		}
		if err := q.UpsertCharacter(ctx, params); err != nil {
			return "", fmt.Errorf("upsert character %s: %w", character.ID, err)
		}
	}
	if err := q.DeleteCharactersNotIn(ctx, characterIDs(characters)); err != nil {
		return "", fmt.Errorf("prune characters: %w", err)
	}
	if err := q.DeleteWorksNotIn(ctx, workIDs(works)); err != nil {
		return "", fmt.Errorf("prune works: %w", err)
	}

	snapshot, err := json.Marshal(characters)
	if err != nil {
		return "", err
	}
	if err := q.UpsertSnapshot(ctx, repo.UpsertSnapshotParams{
		Version:    version,
		Characters: snapshot,
	}); err != nil {
		return "", fmt.Errorf("upsert snapshot: %w", err)
	}
	if err := q.UpsertCatalogState(ctx, version); err != nil {
		return "", fmt.Errorf("upsert catalog state: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit seed: %w", err)
	}
	return version, nil
}
