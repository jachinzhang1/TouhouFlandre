package game_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
)

func loadCatalogEquivalenceCharacters(t *testing.T) []game.Character {
	t.Helper()
	dataDir := filepath.Join("..", "..", "..", "..", "packages", "data", "src")
	var works []struct {
		ID          string `json:"id"`
		TitleZh     string `json:"titleZh"`
		Type        string `json:"type"`
		ReleaseYear int    `json:"releaseYear"`
	}
	read := func(name string, target any) {
		raw, err := os.ReadFile(filepath.Join(dataDir, name))
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(raw, target); err != nil {
			t.Fatal(err)
		}
	}
	read("works.demo.json", &works)
	worksByID := make(map[string]struct {
		title    string
		typeName string
		year     int
	}, len(works))
	for _, work := range works {
		worksByID[work.ID] = struct {
			title    string
			typeName string
			year     int
		}{work.TitleZh, work.Type, work.ReleaseYear}
	}
	var sources []struct {
		ID              string `json:"id"`
		FirstAppearance struct {
			WorkID string `json:"workId"`
		} `json:"firstAppearance"`
		Species        []string `json:"species"`
		Affiliations   []string `json:"affiliations"`
		Locations      []string `json:"locations"`
		HairColors     []string `json:"hairColors"`
		EnabledAsGuess bool     `json:"enabledAsGuess"`
	}
	read("characters.demo.json", &sources)
	characters := make([]game.Character, 0, len(sources))
	for _, source := range sources {
		work := worksByID[source.FirstAppearance.WorkID]
		characters = append(characters, game.Character{
			ID: source.ID, EnabledAsGuess: source.EnabledAsGuess,
			FirstAppearance: game.FirstAppearance{
				WorkID: source.FirstAppearance.WorkID, WorkTitle: work.title,
				WorkType: work.typeName, ReleaseYear: work.year,
			},
			Species: source.Species, Affiliations: source.Affiliations,
			Locations: source.Locations, HairColors: source.HairColors,
		})
	}
	return characters
}

func directlyEquivalent(left, right game.Character) bool {
	for _, definition := range game.CharacterFields.Definitions() {
		if !definition.Equivalence {
			continue
		}
		leftValue, leftOK := game.CharacterFields.CanonicalValue(left, definition.Key)
		rightValue, rightOK := game.CharacterFields.CanonicalValue(right, definition.Key)
		if !leftOK || !rightOK || !reflect.DeepEqual(leftValue, rightValue) {
			return false
		}
	}
	return true
}

func TestCurrentCatalogEquivalenceIndexMatchesPairwiseComparison(t *testing.T) {
	characters := loadCatalogEquivalenceCharacters(t)
	runtime, err := game.BuildCatalogRuntime("current-test", game.AnswerMatchPublicFieldsV1, characters)
	if err != nil {
		t.Fatal(err)
	}
	for leftIndex, left := range characters {
		if !left.EnabledAsGuess {
			continue
		}
		for rightIndex := leftIndex + 1; rightIndex < len(characters); rightIndex++ {
			right := characters[rightIndex]
			if !right.EnabledAsGuess {
				continue
			}
			direct := directlyEquivalent(left, right)
			indexed := runtime.GroupKey(left.ID) == runtime.GroupKey(right.ID)
			if direct != indexed {
				t.Fatalf("pairwise/index mismatch for %s and %s: direct=%v indexed=%v", left.ID, right.ID, direct, indexed)
			}
		}
	}
}
