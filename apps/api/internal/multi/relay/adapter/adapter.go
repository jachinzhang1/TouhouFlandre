// Package adapter translates the current two-player relay model into kernel capabilities.
package adapter

import (
	legacy "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay"
)

type Module struct{}

func New() Module { return Module{} }

func (Module) PrepareRoom(config core.RoomConfig) (core.RoomConfig, error) {
	if config.Mode != core.ModeRelay {
		return core.RoomConfig{}, &core.DomainError{Code: core.ErrorInvalidConfiguration, Mode: config.Mode, Detail: "relay mode is required"}
	}
	if config.PlayerLimit != legacy.RelayPlayerLimit {
		return core.RoomConfig{}, &core.DomainError{Code: core.ErrorInvalidConfiguration, Mode: config.Mode, Detail: "legacy relay requires exactly two player seats"}
	}
	if config.PlayerLimitSpecified {
		return core.RoomConfig{}, &core.DomainError{Code: core.ErrorInvalidConfiguration, Mode: config.Mode, Detail: "legacy relay player limit cannot be configured"}
	}
	if !legacy.ValidTurnSeconds(config.TurnSeconds) {
		return core.RoomConfig{}, &core.DomainError{Code: core.ErrorInvalidConfiguration, Mode: config.Mode, Detail: "turn seconds are invalid"}
	}
	return config, nil
}

func (Module) ReadyRoster(roster []core.RosterMember, playerLimit int) bool {
	if len(roster) != legacy.RelayPlayerLimit || playerLimit != legacy.RelayPlayerLimit {
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
	if input.Mode != core.ModeRelay || input.RosterSize != legacy.RelayPlayerLimit {
		return core.MatchPlan{}, &core.DomainError{Code: core.ErrorInvalidConfiguration, Mode: input.Mode, Detail: "legacy relay requires exactly two players"}
	}
	format := legacy.RoomFormat(input.Format)
	startsAt := input.Now.Add(input.RoundCountdown)
	firstTurn, turnDeadline := legacy.InitialRelayTurn(1, input.TurnSeconds, startsAt)
	timing := legacy.TimingConfig{RoundSeconds: input.RoundSeconds, RaceRoundSeconds: input.RaceRoundSeconds}
	return core.MatchPlan{
		RuleSet:       relay.LegacyRuleSet(),
		ScoringMode:   string(legacy.ScoringModeWins),
		TargetWins:    legacy.TargetWins(format),
		MaxRounds:     legacy.MaxRounds(format, input.MaxRoundsFactor),
		StartsAt:      startsAt,
		Deadline:      startsAt.Add(legacy.RoundDurationForMode(legacy.MultiplayerModeRelay, timing)),
		FirstTurnSeat: &firstTurn,
		TurnDeadline:  &turnDeadline,
	}, nil
}

func (Module) ParseLegacy(scoringMode string) (core.RuleSetRef, error) {
	if legacy.ScoringMode(scoringMode) != legacy.ScoringModeWins {
		return core.RuleSetRef{}, &core.DomainError{Code: core.ErrorInvalidRuleSet, Mode: core.ModeRelay, Detail: "legacy relay requires wins compatibility scoring"}
	}
	return relay.LegacyRuleSet(), nil
}

func (Module) Handle(ctx core.CommandContext) (core.CommandResult, error) {
	if ctx.RuleSet != relay.LegacyRuleSet() {
		return core.CommandResult{}, &core.DomainError{Code: core.ErrorInvalidRuleSet, Mode: ctx.RuleSet.Mode, RuleSet: ctx.RuleSet}
	}
	switch ctx.Command {
	case core.CommandGuess, core.CommandPass, core.CommandForfeit:
		return core.CommandResult{Route: core.CommandRouteLegacyRelay, Accepted: true}, nil
	default:
		return core.CommandResult{}, &core.DomainError{Code: core.ErrorUnsupportedCommand, Mode: core.ModeRelay, RuleSet: ctx.RuleSet, Capability: "command_handler"}
	}
}

func (Module) Route(ref core.RuleSetRef) (core.CompletionRoute, error) {
	if ref != relay.LegacyRuleSet() {
		return "", &core.DomainError{Code: core.ErrorInvalidRuleSet, Mode: ref.Mode, RuleSet: ref}
	}
	return core.CompletionRouteLegacyRelay, nil
}

func (Module) Style(ref core.RuleSetRef) (core.ProjectionStyle, error) {
	if ref != relay.LegacyRuleSet() {
		return "", &core.DomainError{Code: core.ErrorInvalidRuleSet, Mode: ref.Mode, RuleSet: ref}
	}
	return core.ProjectionRelayShared, nil
}

type Recovery Module

func (Recovery) Route(ref core.RuleSetRef) (core.RecoveryRoute, error) {
	if ref != relay.LegacyRuleSet() {
		return "", &core.DomainError{Code: core.ErrorInvalidRuleSet, Mode: ref.Mode, RuleSet: ref}
	}
	return core.RecoveryRouteLegacyRelay, nil
}
