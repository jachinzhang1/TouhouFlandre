package game_test

import (
	"testing"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
)

func TestPresetQuestionScopeRulesHardTurnLimit(t *testing.T) {
	rules := game.PresetQuestionScopeRules(game.QuestionDifficultyHard)

	if !rules.TurnLimit.Enabled {
		t.Fatal("hard preset should enable the per-turn limit")
	}
	if rules.TurnLimit.Seconds != 45 {
		t.Fatalf("hard turn limit = %d, want 45", rules.TurnLimit.Seconds)
	}
	if !rules.Fields.FirstAppearance {
		t.Fatal("hard preset should keep first appearance visible")
	}
}
