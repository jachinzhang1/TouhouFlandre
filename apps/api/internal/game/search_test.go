package game_test

import (
	"testing"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
)

// 黄金用例：normalizeSearchText 与 nameSortKey 派生（shared search.ts）。
func TestNormalizeSearchText(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  string
	}{
		{name: "strips separators", input: "芙兰朵露・斯卡蕾特", want: "芙兰朵露斯卡蕾特"},
		{name: "strips spaces and dashes", input: "Reimu Hakurei - TH06", want: "reimuhakureith06"},
		{name: "lowercases ascii", input: "Marisa Kirisame", want: "marisakirisame"},
		{name: "nfkc fullwidth to halfwidth", input: "ＴＨ０６", want: "th06"},
		{name: "strips underscore and middle dot", input: "a_b·c", want: "abc"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := game.NormalizeSearchText(tc.input); got != tc.want {
				t.Fatalf("NormalizeSearchText(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestCharacterNameSortKeyPrefersRomaji(t *testing.T) {
	en := "Reimu Hakurei"
	romaji := "Hakurei Reimu"
	character := withPatch(baseCharacter(), func(c *game.Character) {
		c.Names.En = en
		c.Names.Romaji = &romaji
	})
	if got := game.CharacterNameSortKey(character); got != "hakureireimu" {
		t.Fatalf("expected romanized sort key, got %q", got)
	}
}

func TestCharacterNameSortKeyFallsBackToEnglish(t *testing.T) {
	character := withPatch(baseCharacter(), func(c *game.Character) {
		c.Names.En = "Marisa Kirisame"
		c.Names.Romaji = nil
	})
	if got := game.CharacterNameSortKey(character); got != "marisakirisame" {
		t.Fatalf("expected english sort key, got %q", got)
	}
}
