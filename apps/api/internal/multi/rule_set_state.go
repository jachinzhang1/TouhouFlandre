package multi

import (
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
)

// ResolveMatchRuleSet resolves the authoritative persisted RuleSetRef. The
// all-empty fallback exists only for pre-0015 fixtures and staged rollbacks.
func ResolveMatchRuleSet(registry *core.Registry, room repo.MultiRoom, match repo.MultiMatch) (core.RuleSetRef, error) {
	mode := core.Mode(room.Mode)
	if registry == nil {
		return core.RuleSetRef{}, &core.DomainError{Code: core.ErrorMissingCapability, Mode: mode, Capability: "rule_set_registry"}
	}
	hasKey := match.RuleSetKey != ""
	hasVersion := match.RuleSetVersion > 0
	hasConfig := len(match.RuleConfigSnapshot) > 0
	if hasKey && hasVersion && hasConfig {
		ref := core.RuleSetRef{Mode: mode, Key: match.RuleSetKey, Version: int(match.RuleSetVersion)}
		if err := registry.ValidateRuleSet(ref); err != nil {
			return core.RuleSetRef{}, err
		}
		return ref, nil
	}
	if hasKey || hasVersion || hasConfig {
		return core.RuleSetRef{}, &core.DomainError{
			Code: core.ErrorInvalidRuleSet, Mode: mode,
			RuleSet: core.RuleSetRef{Mode: mode, Key: match.RuleSetKey, Version: int(match.RuleSetVersion)},
			Detail:  "persisted match has partial rule-set data",
		}
	}
	return registry.ResolveLegacy(mode, match.ScoringMode)
}
