// Package relay owns relay ruleset identities without depending on race.
package relay

import "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"

const (
	RuleLegacyWins = "legacy_wins"
	RuleVersion    = 1
)

func LegacyRuleSet() core.RuleSetRef {
	return core.RuleSetRef{Mode: core.ModeRelay, Key: RuleLegacyWins, Version: RuleVersion}
}

func SupportedRuleSets() []core.RuleSetRef {
	return []core.RuleSetRef{LegacyRuleSet()}
}
