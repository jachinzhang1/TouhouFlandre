// Package race owns race ruleset identities without depending on relay.
package race

import "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"

const (
	RuleWins      = "wins"
	RulePoints    = "points"
	RulePlacement = "placement"
	RuleVersion   = 1
)

func RuleSet(key string) core.RuleSetRef {
	return core.RuleSetRef{Mode: core.ModeRace, Key: key, Version: RuleVersion}
}

func SupportedRuleSets() []core.RuleSetRef {
	return []core.RuleSetRef{RuleSet(RuleWins), RuleSet(RulePoints), RuleSet(RulePlacement)}
}
