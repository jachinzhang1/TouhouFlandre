package game_test

import (
	"testing"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
)

func baseCharacter() game.Character {
	en := "Test"
	return game.Character{
		ID:           "base",
		AvatarURL:    "/characters/base.png",
		AppearanceOrder: 601,
		Names: game.LocalizedNames{
			ZhHans: "测试角色",
			Ja:     "テスト",
			En:     en,
			Aliases: []string{},
		},
		FirstAppearance: game.FirstAppearance{
			WorkID:      "th06",
			WorkTitle:   "东方红魔乡",
			WorkType:    "game",
			ReleaseYear: 2002,
		},
		Species:        []string{"妖怪"},
		AbilityDisplay: "测试能力",
		AbilityTags:    []string{"操纵"},
		Affiliations:   []string{"红魔馆"},
		Locations:      []string{"幻想乡"},
		Roles:          []string{"Boss"},
		HairColors:     []string{"blue"},
		Playable:       false,
		EnabledAsAnswer: true,
		EnabledAsGuess:  true,
		DifficultyTier:  "easy",
		SourceRefs:      []string{},
	}
}

// patch 就地修改并返回副本（辅助构造变体）。
func withPatch(base game.Character, patch func(*game.Character)) game.Character {
	patched := base
	patch(&patched)
	return patched
}

func feedbackStatus(t *testing.T, result game.GuessResult, field game.GuessFieldKey) game.FeedbackStatus {
	t.Helper()
	for _, feedback := range result.Feedback {
		if feedback.Field == field {
			return feedback.Status
		}
	}
	t.Fatalf("missing feedback for field %q", field)
	return ""
}

// 黄金用例：packages/shared/tests/compare.test.ts 的 compareCharacter 用例。
func TestCompareCharacterHairExact(t *testing.T) {
	guess := withPatch(baseCharacter(), func(c *game.Character) {
		c.ID = "guess"
		c.HairColors = []string{"blue"}
	})
	result := game.CompareCharacter(guess, baseCharacter(), nil)
	if status := feedbackStatus(t, result, game.FieldHairColors); status != game.FeedbackExact {
		t.Fatalf("expected exact, got %s", status)
	}
}

func TestCompareCharacterHairPartial(t *testing.T) {
	guess := withPatch(baseCharacter(), func(c *game.Character) {
		c.ID = "guess"
		c.HairColors = []string{"blue", "green"}
	})
	result := game.CompareCharacter(guess, baseCharacter(), nil)
	if status := feedbackStatus(t, result, game.FieldHairColors); status != game.FeedbackPartial {
		t.Fatalf("expected partial, got %s", status)
	}
}

func TestCompareCharacterHairMiss(t *testing.T) {
	guess := withPatch(baseCharacter(), func(c *game.Character) {
		c.ID = "guess"
		c.HairColors = []string{"red"}
	})
	result := game.CompareCharacter(guess, baseCharacter(), nil)
	if status := feedbackStatus(t, result, game.FieldHairColors); status != game.FeedbackMiss {
		t.Fatalf("expected miss, got %s", status)
	}
}

func TestHairColorLabels(t *testing.T) {
	if got := game.HairColorLabels["none"]; got != "无" {
		t.Fatalf("expected 无 for none, got %q", got)
	}
}

// 未知发色在展示时回退为原始值，与前端 HAIR_COLOR_LABELS[color] ?? color 对齐。
func TestHairColorDisplayFallsBackToRaw(t *testing.T) {
	character := withPatch(baseCharacter(), func(c *game.Character) {
		c.HairColors = []string{"none", "teal"}
	})
	values := game.DisplayValuesForField(character, game.FieldHairColors)
	want := []string{"无", "teal"}
	if len(values) != len(want) {
		t.Fatalf("expected %v, got %v", want, values)
	}
	for i := range want {
		if values[i] != want[i] {
			t.Fatalf("expected %v, got %v", want, values)
		}
	}
}

func TestCompareCharacterReleaseYearHigher(t *testing.T) {
	guess := withPatch(baseCharacter(), func(c *game.Character) {
		c.ID = "guess"
		c.FirstAppearance.ReleaseYear = 1997
	})
	answer := withPatch(baseCharacter(), func(c *game.Character) {
		c.ID = "answer"
		c.FirstAppearance.ReleaseYear = 2002
	})
	result := game.CompareCharacter(guess, answer, nil)
	if status := feedbackStatus(t, result, game.FieldReleaseYear); status != game.FeedbackHigher {
		t.Fatalf("expected higher, got %s", status)
	}
}
