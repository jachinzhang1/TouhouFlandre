// Package relay owns relay ruleset identities without depending on race.
package relay

import "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"

const (
	RuleLegacyWins  = "legacy_wins"
	RuleFixedPoints = "fixed_points"
	RuleElimination = "elimination"
	RuleVersion     = 1
)

func LegacyRuleSet() core.RuleSetRef {
	return core.RuleSetRef{Mode: core.ModeRelay, Key: RuleLegacyWins, Version: RuleVersion}
}

func FixedPointsRuleSet() core.RuleSetRef {
	return core.RuleSetRef{Mode: core.ModeRelay, Key: RuleFixedPoints, Version: RuleVersion}
}

func EliminationRuleSet() core.RuleSetRef {
	return core.RuleSetRef{Mode: core.ModeRelay, Key: RuleElimination, Version: RuleVersion}
}

func SupportedRuleSets() []core.RuleSetRef {
	return []core.RuleSetRef{LegacyRuleSet(), FixedPointsRuleSet(), EliminationRuleSet()}
}
