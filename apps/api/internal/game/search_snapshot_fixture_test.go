package game_test

import (
	"testing"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
)

func TestSearchSnapshotMatchesHSO001FixtureTermsAndSortKeys(t *testing.T) {
	fixture := loadSearchParityFixture(t)
	characters := make([]game.Character, 0, len(fixture.Characters))
	for _, item := range fixture.Characters {
		characters = append(characters, item.toGameCharacter())
	}
	snapshot, err := game.BuildCatalogSearchSnapshot(fixture.CatalogVersion, fixture.IndexSchemaVersion, characters)
	if err != nil {
		t.Fatal(err)
	}
	byID := make(map[string]game.CatalogSearchIndexEntry, len(snapshot.Index.Entries))
	for _, entry := range snapshot.Index.Entries {
		byID[entry.ID] = entry
	}
	for _, item := range fixture.Characters {
		entry, ok := byID[item.ID]
		if !item.EnabledAsGuess {
			if ok {
				t.Errorf("disabled character %q appeared in index", item.ID)
			}
			continue
		}
		character := item.toGameCharacter()
		wantTerms := game.CharacterSearchTerms(character)
		if len(entry.SearchTerms) != len(wantTerms) {
			t.Errorf("%s terms=%v, want %v", item.ID, entry.SearchTerms, wantTerms)
		} else {
			for index := range wantTerms {
				if entry.SearchTerms[index] != wantTerms[index] {
					t.Errorf("%s term[%d]=%q, want %q", item.ID, index, entry.SearchTerms[index], wantTerms[index])
				}
			}
		}
		if entry.NameSortKey != game.CharacterNameSortKey(character) {
			t.Errorf("%s nameSortKey=%q, want %q", item.ID, entry.NameSortKey, game.CharacterNameSortKey(character))
		}
	}
}
