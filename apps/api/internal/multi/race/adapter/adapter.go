// Package adapter translates the current race persistence model into kernel capabilities.
package adapter

import (
	legacy "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/race"
)

type Module struct{}

func New() Module { return Module{} }

func validateRuleSet(ref core.RuleSetRef) error {
	for _, supported := range race.SupportedRuleSets() {
		if ref == supported {
			return nil
		}
	}
	return &core.DomainError{Code: core.ErrorInvalidRuleSet, Mode: ref.Mode, RuleSet: ref}
}

func (Module) PrepareRoom(config core.RoomConfig) (core.RoomConfig, error) {
	if config.Mode != core.ModeRace || !legacy.ValidPlayerLimit(legacy.MultiplayerModeRace, config.PlayerLimit) {
		return core.RoomConfig{}, &core.DomainError{Code: core.ErrorInvalidConfiguration, Mode: config.Mode, Detail: "race player limit must be between 2 and 8"}
	}
	if !legacy.ValidTurnSeconds(config.TurnSeconds) {
		return core.RoomConfig{}, &core.DomainError{Code: core.ErrorInvalidConfiguration, Mode: config.Mode, Detail: "turn seconds are invalid"}
	}
	return config, nil
}

func (Module) ReadyRoster(roster []core.RosterMember, playerLimit int) bool {
	if len(roster) < legacy.MinPlayers || len(roster) > playerLimit {
		return false
	}
	hasHost := false
	for _, member := range roster {
		if !member.Player || !member.Connected || !member.Ready {
			return false
		}
		hasHost = hasHost || member.Seat == 1
	}
	return hasHost
}

func (Module) Plan(input core.MatchPlanInput) (core.MatchPlan, error) {
	if input.Mode != core.ModeRace || input.RosterSize < legacy.MinPlayers {
		return core.MatchPlan{}, &core.DomainError{Code: core.ErrorInvalidConfiguration, Mode: input.Mode, Detail: "race roster is invalid"}
	}
	format := legacy.RoomFormat(input.Format)
	scoringMode := legacy.FrozenRaceScoringMode(input.RosterSize, input.RaceEliminationEnabled)
	rules := legacy.RaceRulesForScoringMode(scoringMode)
	maxRounds := rules.MatchMaxRounds(format, input.RosterSize, input.MaxRoundsFactor)
	startsAt := input.Now.Add(input.RoundCountdown)
	timing := legacy.TimingConfig{RoundSeconds: input.RoundSeconds, RaceRoundSeconds: input.RaceRoundSeconds}
	return core.MatchPlan{
		RuleSet:     race.RuleSet(string(scoringMode)),
		ScoringMode: string(scoringMode),
		TargetWins:  legacy.TargetWins(format),
		MaxRounds:   maxRounds,
		StartsAt:    startsAt,
		Deadline:    startsAt.Add(legacy.RoundDurationForMode(legacy.MultiplayerModeRace, timing)),
	}, nil
}

func (Module) ParseLegacy(scoringMode string) (core.RuleSetRef, error) {
	switch legacy.ScoringMode(scoringMode) {
	case legacy.ScoringModeWins, legacy.ScoringModePoints, legacy.ScoringModePlacement:
		return race.RuleSet(scoringMode), nil
	default:
		return core.RuleSetRef{}, &core.DomainError{Code: core.ErrorInvalidRuleSet, Mode: core.ModeRace, Detail: "race scoring mode is not interpretable"}
	}
}

func (Module) Handle(ctx core.CommandContext) (core.CommandResult, error) {
	if err := validateRuleSet(ctx.RuleSet); err != nil {
		return core.CommandResult{}, err
	}
	switch ctx.Command {
	case core.CommandGuess, core.CommandForfeit:
		return core.CommandResult{Route: core.CommandRouteRace, Accepted: true}, nil
	default:
		return core.CommandResult{}, &core.DomainError{Code: core.ErrorUnsupportedCommand, Mode: core.ModeRace, RuleSet: ctx.RuleSet, Capability: "command_handler"}
	}
}

func (Module) Route(ref core.RuleSetRef) (core.CompletionRoute, error) {
	if err := validateRuleSet(ref); err != nil {
		return "", err
	}
	return core.CompletionRouteRace, nil
}

func (Module) Style(ref core.RuleSetRef) (core.ProjectionStyle, error) {
	if err := validateRuleSet(ref); err != nil {
		return "", err
	}
	return core.ProjectionRaceAnonymous, nil
}

// RulesForMatch deliberately composes the existing RaceRules implementation.
// The adapter does not copy wins, points, placement, ranking, or elimination logic.
func (Module) RulesForScoringMode(scoringMode string) legacy.RaceRules {
	return legacy.RaceRulesForScoringMode(legacy.ScoringMode(scoringMode))
}

type Recovery Module

func (Recovery) Route(ref core.RuleSetRef) (core.RecoveryRoute, error) {
	if err := validateRuleSet(ref); err != nil {
		return "", err
	}
	return core.RecoveryRouteRace, nil
}
