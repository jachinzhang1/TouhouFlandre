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
	SearchTerms     []game.SearchTerm          `json:"searchTerms"`
	ExpectedRank    *searchRankingExpectedRank `json:"expectedRank"`
}

type searchRankingExpectedRank struct {
	Kind          string `json:"kind"`
	FieldPriority int    `json:"fieldPriority"`
	Position      int    `json:"position"`
	LengthGap     int    `json:"lengthGap"`
}

type rankedSearchEntry struct {
	entry searchRankingEntry
	rank  game.SearchMatchRank
	found bool
}

func TestSearchTermFieldPriorityGroups(t *testing.T) {
	cases := map[game.SearchTermSource]int{
		game.SearchTermSourceZhHans:             0,
		game.SearchTermSourceZhHant:             0,
		game.SearchTermSourceJa:                 1,
		game.SearchTermSourceEn:                 1,
		game.SearchTermSourceRomaji:             1,
		game.SearchTermSourceAlias:              2,
		game.SearchTermSourceWorkTitle:          3,
		game.SearchTermSourceWorkID:             3,
		game.SearchTermSourceWorkPinyinInitials: 3,
		game.SearchTermSourceMainlineIndex:      3,
	}
	for source, expected := range cases {
		if actual := game.SearchTermFieldPriority(source); actual != expected {
			t.Errorf("priority for %q = %d, want %d", source, actual, expected)
		}
	}
	if actual := game.SearchTermFieldPriority("unknown"); actual != 4 {
		t.Errorf("priority for unknown source = %d, want 4", actual)
	}
}

func TestCompareSearchMatchRankSequences(t *testing.T) {
	exact := game.SearchMatchRank{Kind: game.SearchMatchExact}
	prefix := game.SearchMatchRank{Kind: game.SearchMatchPrefix, LengthGap: 1}
	if comparison := game.CompareSearchMatchRankSequences(
		[]game.SearchMatchRank{exact, prefix},
		[]game.SearchMatchRank{prefix, exact},
	); comparison >= 0 {
		t.Fatalf("character rank must compare first, got %d", comparison)
	}
	if comparison := game.CompareSearchMatchRankSequences(
		[]game.SearchMatchRank{exact, exact},
		[]game.SearchMatchRank{exact, prefix},
	); comparison >= 0 {
		t.Fatalf("work rank must break a character-rank tie, got %d", comparison)
	}
}

func TestSearchRankingFixture(t *testing.T) {
	fixture := loadJSONFixture[searchRankingFixture](t, "docs/hybrid-search-optimization/fixtures/search-ranking-v2.json")
	if fixture.Contract != "hso.search-ranking.v2" {
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
		Kind: expectedKind, FieldPriority: entry.ExpectedRank.FieldPriority,
		Position: entry.ExpectedRank.Position, LengthGap: entry.ExpectedRank.LengthGap,
	}
	if rank != expected {
		t.Fatalf("%s rank = %+v, want %+v", entry.ID, rank, expected)
	}
}
