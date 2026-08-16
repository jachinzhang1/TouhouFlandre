package game_test

import (
	"strings"
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
		{name: "nfkc circled number to digit", input: "⑨", want: "9"},
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

func TestCharacterSearchTermsKeepFieldBoundaries(t *testing.T) {
	character := withPatch(baseCharacter(), func(c *game.Character) {
		zhHant := "博麗靈夢"
		romaji := "Hakurei Reimu"
		mainlineIndex := 1
		c.Names.ZhHans = "博丽灵梦"
		c.Names.ZhHant = &zhHant
		c.Names.Ja = "博麗霊夢"
		c.Names.En = "Reimu Hakurei"
		c.Names.Romaji = &romaji
		c.Names.Aliases = []string{"灵梦", "红白", "bllm"}
		c.FirstAppearance.WorkTitle = "东方灵异传"
		c.FirstAppearance.WorkID = "th01_hrtp"
		c.FirstAppearance.MainlineIndex = &mainlineIndex
		c.FirstAppearance.WorkPinyinInitials = []string{"lyc", "dflyc"}
	})

	for _, query := range []string{"博丽灵梦", "靈夢", "霊夢", "Reimu", "Hakurei Reimu", "红白", "bllm", "东方灵异传", "th01_hrtp", "TH01", "lyc", "dflyc", "东方 灵异传"} {
		if !game.MatchCharacterQuery(character, query) {
			t.Errorf("expected %q to match", query)
		}
	}
	if game.MatchCharacterQuery(character, "梦东") {
		t.Fatal("query must not match across name/work field boundary")
	}
	if game.MatchCharacterQuery(character, "梦灵") {
		t.Fatal("query must not match across full-name/alias field boundary")
	}
	if got := game.CharacterSearchText(character); !strings.Contains(got, " 灵梦 ") || strings.Contains(got, "博丽灵梦灵梦") {
		t.Fatalf("compatibility search text must preserve field boundaries: %q", got)
	}
}

func TestSearchCharactersByWorkInitialsAndPage(t *testing.T) {
	reimu := withPatch(baseCharacter(), func(c *game.Character) {
		c.ID = "reimu"
		c.AppearanceOrder = 1
		c.Names.En = "Reimu"
		c.FirstAppearance.WorkPinyinInitials = []string{"hmx", "dfhmx"}
	})
	marisa := withPatch(baseCharacter(), func(c *game.Character) {
		c.ID = "marisa"
		c.AppearanceOrder = 2
		c.Names.En = "Marisa"
		c.FirstAppearance.WorkPinyinInitials = []string{"hmx", "dfhmx"}
	})
	disabled := withPatch(baseCharacter(), func(c *game.Character) {
		c.ID = "disabled"
		c.EnabledAsGuess = false
		c.FirstAppearance.WorkPinyinInitials = []string{"hmx", "dfhmx"}
	})

	page := game.SearchCharacters([]game.Character{marisa, disabled, reimu}, game.CharacterSearchOptions{
		Query: "ＤＦＨＭＸ", SortBy: "appearance", Offset: 1, Limit: 1,
	})
	if page.Total != 2 || len(page.Characters) != 1 || page.Characters[0].ID != "marisa" {
		t.Fatalf("unexpected search page: %+v", page)
	}
}

func TestSearchCharactersReturnsEveryCharacterSharingAlias(t *testing.T) {
	shizuha := withPatch(baseCharacter(), func(c *game.Character) {
		c.ID = "shizuha_aki"
		c.AppearanceOrder = 1001
		c.Names.ZhHans = "秋静叶"
		c.Names.En = "Shizuha Aki"
		c.Names.Aliases = []string{"秋姐妹"}
	})
	minoriko := withPatch(baseCharacter(), func(c *game.Character) {
		c.ID = "minoriko_aki"
		c.AppearanceOrder = 1002
		c.Names.ZhHans = "秋穰子"
		c.Names.En = "Minoriko Aki"
		c.Names.Aliases = []string{"秋姐妹"}
	})

	page := game.SearchCharacters([]game.Character{minoriko, shizuha}, game.CharacterSearchOptions{
		Query: "秋姐妹", SortBy: "appearance", Limit: -1,
	})
	if page.Total != 2 || len(page.Characters) != 2 {
		t.Fatalf("shared alias should return both characters: %+v", page)
	}
	if page.Characters[0].ID != "shizuha_aki" || page.Characters[1].ID != "minoriko_aki" {
		t.Fatalf("shared alias results are incorrect: %+v", page.Characters)
	}
}
