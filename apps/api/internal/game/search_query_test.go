package game_test

import (
	"reflect"
	"testing"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
)

func TestParseSearchQuery(t *testing.T) {
	cases := []struct {
		input string
		want  game.ParsedSearchQuery
	}{
		{input: "  mm  ", want: game.ParsedSearchQuery{Text: "mm"}},
		{input: "  mm  @  lyz  ", want: game.ParsedSearchQuery{Scoped: true, CharacterText: "mm", WorkText: "lyz"}},
		{input: "mm@", want: game.ParsedSearchQuery{Scoped: true, CharacterText: "mm"}},
		{input: "@10", want: game.ParsedSearchQuery{Scoped: true, WorkText: "10"}},
		{input: "@", want: game.ParsedSearchQuery{Scoped: true}},
		{input: "mm@lyz@ignored", want: game.ParsedSearchQuery{Scoped: true, CharacterText: "mm", WorkText: "lyz@ignored"}},
		{input: "mm＠lyz", want: game.ParsedSearchQuery{Text: "mm＠lyz"}},
	}
	for _, tc := range cases {
		if got := game.ParseSearchQuery(tc.input); !reflect.DeepEqual(got, tc.want) {
			t.Errorf("ParseSearchQuery(%q) = %+v, want %+v", tc.input, got, tc.want)
		}
	}
}

func TestSearchTermDomainForSourceCoversEverySupportedSource(t *testing.T) {
	cases := map[game.SearchTermSource]game.SearchTermDomain{
		game.SearchTermSourceZhHans:             game.SearchTermDomainCharacter,
		game.SearchTermSourceZhHant:             game.SearchTermDomainCharacter,
		game.SearchTermSourceJa:                 game.SearchTermDomainCharacter,
		game.SearchTermSourceEn:                 game.SearchTermDomainCharacter,
		game.SearchTermSourceRomaji:             game.SearchTermDomainCharacter,
		game.SearchTermSourceAlias:              game.SearchTermDomainCharacter,
		game.SearchTermSourceWorkTitle:          game.SearchTermDomainWork,
		game.SearchTermSourceWorkID:             game.SearchTermDomainWork,
		game.SearchTermSourceWorkPinyinInitials: game.SearchTermDomainWork,
		game.SearchTermSourceMainlineIndex:      game.SearchTermDomainWork,
	}
	for source, expected := range cases {
		actual, ok := game.SearchTermDomainForSource(source)
		if !ok || actual != expected {
			t.Errorf("domain for %q = (%d, %t), want (%d, true)", source, actual, ok, expected)
		}
	}
	if _, ok := game.SearchTermDomainForSource("unknown"); ok {
		t.Fatal("unknown source must not have a domain")
	}
}
