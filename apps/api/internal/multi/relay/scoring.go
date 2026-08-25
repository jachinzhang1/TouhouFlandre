package relay

import (
	"fmt"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
)

type ScoringPolicyRouter struct {
	policies map[core.RuleSetRef]ScoringPolicy
}

func NewScoringPolicyRouter(policies map[core.RuleSetRef]ScoringPolicy) (*ScoringPolicyRouter, error) {
	if len(policies) == 0 {
		return nil, fmt.Errorf("%w: at least one scoring policy is required", ErrInvalidStagePlan)
	}
	registered := make(map[core.RuleSetRef]ScoringPolicy, len(policies))
	for ref, policy := range policies {
		if ref.Mode != core.ModeRelay || ref.Key == "" || ref.Version < 1 || policy == nil {
			return nil, fmt.Errorf("%w: invalid scoring policy registration for %s", ErrInvalidStagePlan, ref)
		}
		registered[ref] = policy
	}
	return &ScoringPolicyRouter{policies: registered}, nil
}

func (r *ScoringPolicyRouter) Settle(input SettlementInput) (SettlementDecision, error) {
	if r == nil {
		return SettlementDecision{}, fmt.Errorf("%w: scoring policy router is nil", ErrInvalidStagePlan)
	}
	policy, ok := r.policies[input.Match.RuleSet]
	if !ok {
		return SettlementDecision{}, fmt.Errorf("%w: unsupported relay rule set %s", ErrInvalidStagePlan, input.Match.RuleSet)
	}
	return policy.Settle(input)
}

func InitialScoreForRuleSet(ref core.RuleSetRef) (int, error) {
	switch ref {
	case LegacyRuleSet(), FixedPointsRuleSet():
		return 0, nil
	case EliminationRuleSet():
		return EliminationInitialScore, nil
	default:
		return 0, fmt.Errorf("%w: unsupported relay rule set %s", ErrInvalidStagePlan, ref)
	}
}
