package game_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
)

type searchParityFixture struct {
	Contract           string                   `json:"contract"`
	CatalogVersion     string                   `json:"catalogVersion"`
	IndexSchemaVersion int                      `json:"indexSchemaVersion"`
	Characters         []searchFixtureCharacter `json:"characters"`
	Cases              []searchParityCase       `json:"cases"`
}

type searchFixtureCharacter struct {
	ID              string                  `json:"id"`
	EnabledAsGuess  bool                    `json:"enabledAsGuess"`
	AppearanceOrder int                     `json:"appearanceOrder"`
	AvatarURL       string                  `json:"avatarUrl"`
	Names           searchFixtureNames      `json:"names"`
	FirstAppearance searchFixtureAppearance `json:"firstAppearance"`
	Species         []string                `json:"species"`
	Affiliations    []string                `json:"affiliations"`
	Locations       []string                `json:"locations"`
	HairColors      []string                `json:"hairColors"`
}

type searchFixtureNames struct {
	ZhHans  string   `json:"zhHans"`
	ZhHant  *string  `json:"zhHant"`
	Ja      string   `json:"ja"`
	En      string   `json:"en"`
	Romaji  *string  `json:"romaji"`
	Aliases []string `json:"aliases"`
}

type searchFixtureAppearance struct {
	WorkID             string   `json:"workId"`
	WorkTitle          string   `json:"workTitle"`
	WorkType           string   `json:"workType"`
	ReleaseYear        int      `json:"releaseYear"`
	MainlineIndex      *int     `json:"mainlineIndex"`
	WorkPinyinInitials []string `json:"workPinyinInitials"`
}

type searchParityCase struct {
	Name                 string               `json:"name"`
	Query                string               `json:"query"`
	SelectedCharacterIDs []string             `json:"selectedCharacterIds"`
	WorkIDs              []string             `json:"workIds"`
	SortBy               string               `json:"sortBy"`
	Descending           bool                 `json:"descending"`
	Offset               int                  `json:"offset"`
	Limit                int                  `json:"limit"`
	Expected             searchParityExpected `json:"expected"`
}

type searchParityExpected struct {
	IDs   []string `json:"ids"`
	Total int      `json:"total"`
}

type failureMatrixFixture struct {
	Contract           string              `json:"contract"`
	CatalogVersion     string              `json:"catalogVersion"`
	IndexSchemaVersion int                 `json:"indexSchemaVersion"`
	PolicyRevision     string              `json:"policyRevision"`
	FallbackReasons    []string            `json:"fallbackReasons"`
	Cases              []failureMatrixCase `json:"cases"`
}

type failureMatrixCase struct {
	Name           string                `json:"name"`
	State          failureMatrixState    `json:"state"`
	PolicyResponse *failureResponse      `json:"policyResponse"`
	IndexResponse  *failureResponse      `json:"indexResponse"`
	Expected       failureMatrixExpected `json:"expected"`
}

type failureMatrixState struct {
	HasValidatedPolicy      bool    `json:"hasValidatedPolicy"`
	HasLoadedIndex          bool    `json:"hasLoadedIndex"`
	CatalogVersion          string  `json:"catalogVersion"`
	IndexSchemaVersion      int     `json:"indexSchemaVersion"`
	PolicyRevision          *string `json:"policyRevision"`
	LastKnownGoodAgeSeconds *int    `json:"lastKnownGoodAgeSeconds"`
	RetryStage              int     `json:"retryStage"`
	CacheState              string  `json:"cacheState"`
	CircuitOpen             bool    `json:"circuitOpen"`
}

type failureResponse struct {
	Kind        string `json:"kind"`
	Status      int    `json:"status"`
	Body        string `json:"body"`
	AfterMs     int    `json:"afterMs"`
	AfterReload string `json:"afterReload"`
	Revision    string `json:"revision"`
}

type failureMatrixExpected struct {
	ResultSource          string `json:"resultSource"`
	FaultClass            string `json:"faultClass"`
	NextProbeAfterSeconds *int   `json:"nextProbeAfterSeconds"`
	FallbackReason        string `json:"fallbackReason"`
}

type compatibilityMatrixFixture struct {
	Contract string                    `json:"contract"`
	Cases    []compatibilityMatrixCase `json:"cases"`
}

type compatibilityMatrixCase struct {
	Name        string                `json:"name"`
	Web         string                `json:"web"`
	API         string                `json:"api"`
	PolicyMode  string                `json:"policyMode"`
	IndexState  string                `json:"indexState"`
	PolicyState string                `json:"policyState"`
	Expected    compatibilityExpected `json:"expected"`
}

type compatibilityExpected struct {
	SearchRoute         string `json:"searchRoute"`
	PuzzleFlow          string `json:"puzzleFlow"`
	CompatibilityReason string `json:"compatibilityReason"`
}

func loadJSONFixture[T any](t *testing.T, relativePath string) T {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", relativePath))
	if err != nil {
		t.Fatal(err)
	}
	var value T
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	return value
}

func (c searchFixtureCharacter) toGameCharacter() game.Character {
	return game.Character{
		ID:        c.ID,
		AvatarURL: c.AvatarURL,
		Names:     game.LocalizedNames{ZhHans: c.Names.ZhHans, ZhHant: c.Names.ZhHant, Ja: c.Names.Ja, En: c.Names.En, Romaji: c.Names.Romaji, Aliases: append([]string{}, c.Names.Aliases...)},
		FirstAppearance: game.FirstAppearance{
			WorkID:             c.FirstAppearance.WorkID,
			WorkTitle:          c.FirstAppearance.WorkTitle,
			WorkType:           c.FirstAppearance.WorkType,
			ReleaseYear:        c.FirstAppearance.ReleaseYear,
			MainlineIndex:      c.FirstAppearance.MainlineIndex,
			WorkPinyinInitials: append([]string{}, c.FirstAppearance.WorkPinyinInitials...),
		},
		Species:         append([]string{}, c.Species...),
		Affiliations:    append([]string{}, c.Affiliations...),
		Locations:       append([]string{}, c.Locations...),
		HairColors:      append([]string{}, c.HairColors...),
		EnabledAsGuess:  c.EnabledAsGuess,
		AppearanceOrder: c.AppearanceOrder,
	}
}

func loadSearchParityFixture(t *testing.T) searchParityFixture {
	t.Helper()
	return loadJSONFixture[searchParityFixture](t, "docs/hybrid-search-optimization/fixtures/search-parity-v1.json")
}

func loadFailureMatrixFixture(t *testing.T) failureMatrixFixture {
	t.Helper()
	return loadJSONFixture[failureMatrixFixture](t, "docs/hybrid-search-optimization/fixtures/failure-matrix-v1.json")
}

func loadCompatibilityMatrixFixture(t *testing.T) compatibilityMatrixFixture {
	t.Helper()
	return loadJSONFixture[compatibilityMatrixFixture](t, "docs/hybrid-search-optimization/fixtures/compatibility-matrix-v1.json")
}

func TestSearchParityFixtureMatchesCurrentSearch(t *testing.T) {
	fixture := loadSearchParityFixture(t)
	if fixture.Contract != "hso.search-parity.v1" {
		t.Fatalf("unexpected search contract %q", fixture.Contract)
	}
	if fixture.CatalogVersion == "" || fixture.IndexSchemaVersion != 1 {
		t.Fatalf("unexpected search fixture metadata: %+v", fixture)
	}
	if len(fixture.Characters) == 0 {
		t.Fatal("search fixture needs characters")
	}
	if len(fixture.Cases) != 20 {
		t.Fatalf("unexpected search case count %d", len(fixture.Cases))
	}

	characters := make([]game.Character, 0, len(fixture.Characters))
	characterByID := make(map[string]game.Character, len(fixture.Characters))
	workIDs := make(map[string]struct{}, len(fixture.Characters))
	for _, character := range fixture.Characters {
		if character.ID == "" {
			t.Fatal("fixture character needs id")
		}
		if _, exists := characterByID[character.ID]; exists {
			t.Fatalf("duplicate fixture character id %q", character.ID)
		}
		gameCharacter := character.toGameCharacter()
		characterByID[character.ID] = gameCharacter
		characters = append(characters, gameCharacter)
		workIDs[character.FirstAppearance.WorkID] = struct{}{}
	}

	seenCaseNames := make(map[string]struct{}, len(fixture.Cases))
	for _, tc := range fixture.Cases {
		tc := tc
		t.Run(tc.Name, func(t *testing.T) {
			if _, exists := seenCaseNames[tc.Name]; exists {
				t.Fatalf("duplicate fixture case name %q", tc.Name)
			}
			seenCaseNames[tc.Name] = struct{}{}

			if tc.SortBy != "appearance" && tc.SortBy != "name" {
				t.Fatalf("unexpected sortBy %q", tc.SortBy)
			}
			for _, id := range tc.SelectedCharacterIDs {
				if _, exists := characterByID[id]; !exists {
					t.Fatalf("case %q references unknown selectedCharacterId %q", tc.Name, id)
				}
			}
			for _, workID := range tc.WorkIDs {
				if _, exists := workIDs[workID]; !exists {
					t.Fatalf("case %q references unknown workId %q", tc.Name, workID)
				}
			}
			for _, id := range tc.Expected.IDs {
				if _, exists := characterByID[id]; !exists {
					t.Fatalf("case %q expects unknown character id %q", tc.Name, id)
				}
			}
			if len(tc.Expected.IDs) > tc.Expected.Total {
				t.Fatalf("case %q expected ids exceed total: %+v", tc.Name, tc.Expected)
			}

			filters := []game.CharacterSearchFilter{game.EnabledAsGuessSearchFilter()}
			if tc.SelectedCharacterIDs != nil {
				filters = append(filters, game.CharacterIDsSearchFilter(tc.SelectedCharacterIDs))
			}
			if tc.WorkIDs != nil {
				filters = append(filters, game.WorkIDsSearchFilter(tc.WorkIDs))
			}

			page := game.SearchCharacters(characters, game.CharacterSearchOptions{
				Query:      tc.Query,
				Filters:    filters,
				SortBy:     tc.SortBy,
				Descending: tc.Descending,
				Offset:     tc.Offset,
				Limit:      tc.Limit,
			})
			if page.Total != tc.Expected.Total {
				t.Fatalf("case %q total = %d, want %d", tc.Name, page.Total, tc.Expected.Total)
			}
			if len(page.Characters) != len(tc.Expected.IDs) {
				t.Fatalf("case %q returned %d ids, want %d", tc.Name, len(page.Characters), len(tc.Expected.IDs))
			}
			for index, character := range page.Characters {
				if character.ID != tc.Expected.IDs[index] {
					t.Fatalf("case %q ids[%d] = %q, want %q", tc.Name, index, character.ID, tc.Expected.IDs[index])
				}
			}
		})
	}

	for _, required := range []string{
		"simplified chinese name",
		"traditional chinese name",
		"japanese name",
		"english name",
		"romaji name",
		"hyphen stripping",
		"middle dot stripping",
		"fullwidth th code",
		"work title",
		"work id",
		"work pinyin initials",
		"boundary negative",
		"disabled guesser excluded",
		"shared alias tie-break",
		"empty selected ids deny all",
		"filters before paging",
		"appearance pagination",
		"appearance descending",
		"name ascending",
		"name descending",
	} {
		if _, exists := seenCaseNames[required]; !exists {
			t.Fatalf("search parity fixture missing %q", required)
		}
	}
}

func TestSearchFixtureMatricesAreParseableAndConstrained(t *testing.T) {
	failure := loadFailureMatrixFixture(t)
	if failure.Contract != "hso.failure-matrix.v1" {
		t.Fatalf("unexpected failure contract %q", failure.Contract)
	}
	if len(failure.Cases) != 12 {
		t.Fatalf("unexpected failure case count %d", len(failure.Cases))
	}
	allowedReasons := map[string]struct{}{
		"policy_remote":      {},
		"policy_unavailable": {},
		"context_incomplete": {},
		"index_transient":    {},
		"index_invalid":      {},
		"engine_error":       {},
		"none":               {},
	}
	seenFailureNames := make(map[string]struct{}, len(failure.Cases))
	for _, tc := range failure.Cases {
		if _, exists := seenFailureNames[tc.Name]; exists {
			t.Fatalf("duplicate failure case name %q", tc.Name)
		}
		seenFailureNames[tc.Name] = struct{}{}
		if _, exists := allowedReasons[tc.Expected.FallbackReason]; !exists {
			t.Fatalf("case %q uses unknown fallback reason %q", tc.Name, tc.Expected.FallbackReason)
		}
		if tc.Expected.NextProbeAfterSeconds != nil && *tc.Expected.NextProbeAfterSeconds < 0 {
			t.Fatalf("case %q has negative next probe delay", tc.Name)
		}
	}
	if len(seenFailureNames) != len(failure.Cases) {
		t.Fatal("failure matrix contains duplicate names")
	}
	for _, required := range []string{
		"policy cold start 404",
		"policy cold start 405",
		"policy timeout at three seconds",
		"index timeout first probe",
		"index timeout second probe",
		"index timeout third probe",
		"index timeout fourth probe",
		"last known good within five minutes",
		"last known good expired",
		"cache repair succeeds",
		"cache repair fails",
		"policy revision change resets circuit",
	} {
		if _, exists := seenFailureNames[required]; !exists {
			t.Fatalf("failure matrix missing %q", required)
		}
	}

	compatibility := loadCompatibilityMatrixFixture(t)
	if compatibility.Contract != "hso.compatibility-matrix.v1" {
		t.Fatalf("unexpected compatibility contract %q", compatibility.Contract)
	}
	if len(compatibility.Cases) != 8 {
		t.Fatalf("unexpected compatibility case count %d", len(compatibility.Cases))
	}
	seenCombos := map[string]struct{}{}
	seenModes := map[string]struct{}{}
	for _, tc := range compatibility.Cases {
		key := tc.Web + "/" + tc.API
		seenCombos[key] = struct{}{}
		seenModes[tc.PolicyMode] = struct{}{}
		if tc.Expected.SearchRoute != "remote" && tc.Expected.SearchRoute != "local" {
			t.Fatalf("case %q has unknown search route %q", tc.Name, tc.Expected.SearchRoute)
		}
		if tc.Expected.PuzzleFlow != "legacy" && tc.Expected.PuzzleFlow != "modern" {
			t.Fatalf("case %q has unknown puzzle flow %q", tc.Name, tc.Expected.PuzzleFlow)
		}
	}
	for _, combo := range []string{"old/old", "old/new", "new/old", "new/new"} {
		if _, exists := seenCombos[combo]; !exists {
			t.Fatalf("compatibility matrix missing %s combo", combo)
		}
	}
	if _, exists := seenModes["remote"]; !exists {
		t.Fatal("compatibility matrix missing remote policy mode")
	}
	if _, exists := seenModes["local-primary"]; !exists {
		t.Fatal("compatibility matrix missing local-primary policy mode")
	}
	for _, required := range []string{
		"old web with old api",
		"old web with new api",
		"new web with old api",
		"new web with new api remote",
		"new web with new api local-primary",
		"new web with new api local-primary and index failure",
		"new web with new api local-primary and policy failure",
		"old web with new api local-primary",
	} {
		found := false
		for _, tc := range compatibility.Cases {
			if tc.Name == required {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("compatibility matrix missing %q", required)
		}
	}
}
