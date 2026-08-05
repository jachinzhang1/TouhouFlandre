package game_test

import (
	"testing"
	"time"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
)

// 黄金用例：packages/shared/tests/compare.test.ts 的 daily puzzle 用例。
func TestGetPuzzleDateKeyAsiaShanghaiCalendarDay(t *testing.T) {
	// 2026-08-02T16:30:00Z 在 Asia/Shanghai 是 2026-08-03 00:30。
	instant := time.Date(2026, 8, 2, 16, 30, 0, 0, time.UTC)
	if key := game.GetPuzzleDateKey(instant, nil); key != "2026-08-03" {
		t.Fatalf("expected 2026-08-03, got %s", key)
	}
}

func TestGetDailyAnswerDeterministic(t *testing.T) {
	a := withPatch(baseCharacter(), func(c *game.Character) { c.ID = "a" })
	b := withPatch(baseCharacter(), func(c *game.Character) {
		c.ID = "b"
		c.Names.ZhHans = "角色 B"
	})
	characters := []game.Character{a, b}

	first, err := game.GetDailyAnswer(characters, "2026-08-03")
	if err != nil {
		t.Fatal(err)
	}
	second, err := game.GetDailyAnswer(characters, "2026-08-03")
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID {
		t.Fatalf("expected same answer, got %s then %s", first.ID, second.ID)
	}
}

func TestGetDailyAnswerOrderIndependent(t *testing.T) {
	a := withPatch(baseCharacter(), func(c *game.Character) { c.ID = "a" })
	b := withPatch(baseCharacter(), func(c *game.Character) {
		c.ID = "b"
		c.Names.ZhHans = "角色 B"
	})
	c := withPatch(baseCharacter(), func(c *game.Character) {
		c.ID = "c"
		c.Names.ZhHans = "角色 C"
	})
	forward := []game.Character{a, b, c}
	reversed := []game.Character{c, b, a}

	fromForward, err := game.GetDailyAnswer(forward, "2026-08-03")
	if err != nil {
		t.Fatal(err)
	}
	fromReversed, err := game.GetDailyAnswer(reversed, "2026-08-03")
	if err != nil {
		t.Fatal(err)
	}
	if fromForward.ID != fromReversed.ID {
		t.Fatalf("answer depends on catalog ordering: %s vs %s", fromForward.ID, fromReversed.ID)
	}
}

func TestGetDailyAnswerRequiresAnswerablePool(t *testing.T) {
	character := withPatch(baseCharacter(), func(c *game.Character) {
		c.EnabledAsAnswer = false
	})
	if _, err := game.GetDailyAnswer([]game.Character{character}, "2026-08-03"); err == nil {
		t.Fatal("expected error for empty answer pool")
	}
}
