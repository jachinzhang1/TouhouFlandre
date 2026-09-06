package game_test

import (
	"sort"
	"testing"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
)

type searchRankingFixture struct {
	Contract string              `json:"contract"`
	Cases    []searchRankingCase `json:"cases"`
}

type searchRankingCase struct {
	Name        string               `json:"name"`
	Query       string               `json:"query"`
	Descending  bool                 `json:"descending"`
	Entries     []searchRankingEntry `json:"entries"`
	ExpectedIDs []string             `json:"expectedIds"`
}

type searchRankingEntry struct {
	ID              string                     `json:"id"`
	AppearanceOrder int                        `json:"appearanceOrder"`
	SearchTerms     []string                   `json:"searchTerms"`
	ExpectedRank    *searchRankingExpectedRank `json:"expectedRank"`
}

type searchRankingExpectedRank struct {
	Kind      string `json:"kind"`
	Position  int    `json:"position"`
	LengthGap int    `json:"lengthGap"`
}

type rankedSearchEntry struct {
	entry searchRankingEntry
	rank  game.SearchMatchRank
	found bool
}

func TestSearchRankingFixture(t *testing.T) {
	fixture := loadJSONFixture[searchRankingFixture](t, "docs/hybrid-search-optimization/fixtures/search-ranking-v1.json")
	if fixture.Contract != "hso.search-ranking.v1" {
		t.Fatalf("unexpected ranking contract %q", fixture.Contract)
	}

	for _, tc := range fixture.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			ranked := make([]rankedSearchEntry, 0, len(tc.Entries))
			for _, entry := range tc.Entries {
				rank, found := game.RankSearchTerms(tc.Query, entry.SearchTerms)
				assertExpectedSearchRank(t, entry, rank, found)
				if tc.Query != "" && !found {
					continue
				}
				ranked = append(ranked, rankedSearchEntry{entry: entry, rank: rank, found: found})
			}

			sort.Slice(ranked, func(i, j int) bool {
				left, right := ranked[i], ranked[j]
				if left.found && right.found {
					comparison := game.CompareSearchMatchRanks(left.rank, right.rank)
					if comparison != 0 {
						if tc.Descending {
							return comparison > 0
						}
						return comparison < 0
					}
				}
				if left.entry.AppearanceOrder != right.entry.AppearanceOrder {
					return left.entry.AppearanceOrder < right.entry.AppearanceOrder
				}
				return left.entry.ID < right.entry.ID
			})

			if len(ranked) != len(tc.ExpectedIDs) {
				t.Fatalf("ranked %d entries, want %d", len(ranked), len(tc.ExpectedIDs))
			}
			for index, expectedID := range tc.ExpectedIDs {
				if ranked[index].entry.ID != expectedID {
					t.Fatalf("ranked[%d] = %q, want %q", index, ranked[index].entry.ID, expectedID)
				}
			}
		})
	}
}

func assertExpectedSearchRank(t *testing.T, entry searchRankingEntry, rank game.SearchMatchRank, found bool) {
	t.Helper()
	if entry.ExpectedRank == nil {
		if found {
			t.Fatalf("%s unexpectedly matched with rank %+v", entry.ID, rank)
		}
		return
	}
	if !found {
		t.Fatalf("%s did not match", entry.ID)
	}
	kinds := map[string]game.SearchMatchKind{
		"exact":     game.SearchMatchExact,
		"prefix":    game.SearchMatchPrefix,
		"substring": game.SearchMatchSubstring,
	}
	expectedKind, ok := kinds[entry.ExpectedRank.Kind]
	if !ok {
		t.Fatalf("%s has unknown expected kind %q", entry.ID, entry.ExpectedRank.Kind)
	}
	expected := game.SearchMatchRank{
		Kind: expectedKind, Position: entry.ExpectedRank.Position, LengthGap: entry.ExpectedRank.LengthGap,
	}
	if rank != expected {
		t.Fatalf("%s rank = %+v, want %+v", entry.ID, rank, expected)
	}
}
