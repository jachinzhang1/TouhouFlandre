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
	if !legacy.ValidPlayerLimit(legacy.MultiplayerModeRelay, config.PlayerLimit) {
		return core.RoomConfig{}, &core.DomainError{Code: core.ErrorInvalidConfiguration, Mode: config.Mode, Detail: "relay player limit must be one of 2, 4, 6, or 8"}
	}
	if !legacy.ValidTurnSeconds(config.TurnSeconds) {
		return core.RoomConfig{}, &core.DomainError{Code: core.ErrorInvalidConfiguration, Mode: config.Mode, Detail: "turn seconds are invalid"}
	}
	return config, nil
}

func (Module) ReadyRoster(roster []core.RosterMember, playerLimit int) bool {
	return (Module{}).ReadyDecision(roster, playerLimit).Allowed
}

func (Module) ReadyDecision(roster []core.RosterMember, playerLimit int) core.RoomStartDecision {
	if len(roster) < legacy.MinPlayers {
		return core.RoomStartDecision{Reason: core.StartBlockedNotEnoughPlayers}
	}
	if len(roster) > playerLimit {
		return core.RoomStartDecision{Reason: core.StartBlockedNotEnoughPlayers}
	}
	if len(roster)%2 != 0 {
		return core.RoomStartDecision{Reason: core.StartBlockedOddPlayerCount}
	}
	hasHost := false
	for _, member := range roster {
		if !member.Player {
			return core.RoomStartDecision{Reason: core.StartBlockedNotEnoughPlayers}
		}
		if !member.Connected {
			return core.RoomStartDecision{Reason: core.StartBlockedPlayerDisconnected}
		}
		if !member.Ready {
			return core.RoomStartDecision{Reason: core.StartBlockedPlayerNotReady}
		}
		hasHost = hasHost || member.Seat == 1
	}
	if !hasHost {
		return core.RoomStartDecision{Reason: core.StartBlockedHostMissing}
	}
	return core.RoomStartDecision{Allowed: true}
}

func (Module) Plan(input core.MatchPlanInput) (core.MatchPlan, error) {
	if input.Mode != core.ModeRelay {
		return core.MatchPlan{}, &core.DomainError{Code: core.ErrorInvalidConfiguration, Mode: input.Mode, Detail: "relay mode is required"}
	}
	format := legacy.RoomFormat(input.Format)
	formatNumber := legacy.FormatNumber(format)
	if formatNumber < 1 {
		return core.MatchPlan{}, &core.DomainError{Code: core.ErrorInvalidConfiguration, Mode: input.Mode, Detail: "relay format is invalid"}
	}
	startsAt := input.Now.Add(input.RoundCountdown)
	timing := legacy.TimingConfig{RoundSeconds: input.RoundSeconds, RaceRoundSeconds: input.RaceRoundSeconds}
	plan := core.MatchPlan{
		ScoringMode: string(legacy.ScoringModeWins),
		TargetWins:  legacy.TargetWins(format),
		StartsAt:    startsAt,
		Deadline:    startsAt.Add(legacy.RoundDurationForMode(legacy.MultiplayerModeRelay, timing)),
	}
	switch input.RosterSize {
	case legacy.RelayPlayerLimit:
		firstTurn, turnDeadline := legacy.InitialRelayTurn(1, input.TurnSeconds, startsAt)
		plan.RuleSet = relay.LegacyRuleSet()
		plan.MaxRounds = legacy.MaxRounds(format, input.MaxRoundsFactor)
		plan.FirstTurnSeat = &firstTurn
		plan.TurnDeadline = &turnDeadline
	case 4, 6, 8:
		if input.RelayEliminationEnabled {
			plan.RuleSet = relay.EliminationRuleSet()
		} else {
			plan.RuleSet = relay.FixedPointsRuleSet()
		}
		plan.MaxRounds = formatNumber
	default:
		return core.MatchPlan{}, &core.DomainError{Code: core.ErrorInvalidConfiguration, Mode: input.Mode, Detail: "relay roster must contain 2, 4, 6, or 8 players"}
	}
	return plan, nil
}

func (Module) ParseLegacy(scoringMode string) (core.RuleSetRef, error) {
	if legacy.ScoringMode(scoringMode) != legacy.ScoringModeWins {
		return core.RuleSetRef{}, &core.DomainError{Code: core.ErrorInvalidRuleSet, Mode: core.ModeRelay, Detail: "legacy relay requires wins compatibility scoring"}
	}
	return relay.LegacyRuleSet(), nil
}

func (Module) Handle(ctx core.CommandContext) (core.CommandResult, error) {
	if ctx.RuleSet != relay.LegacyRuleSet() && ctx.RuleSet != relay.FixedPointsRuleSet() && ctx.RuleSet != relay.EliminationRuleSet() {
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
	if ref != relay.LegacyRuleSet() && ref != relay.FixedPointsRuleSet() && ref != relay.EliminationRuleSet() {
		return "", &core.DomainError{Code: core.ErrorInvalidRuleSet, Mode: ref.Mode, RuleSet: ref}
	}
	return core.CompletionRouteLegacyRelay, nil
}

func (Module) Style(ref core.RuleSetRef) (core.ProjectionStyle, error) {
	if ref != relay.LegacyRuleSet() && ref != relay.FixedPointsRuleSet() && ref != relay.EliminationRuleSet() {
		return "", &core.DomainError{Code: core.ErrorInvalidRuleSet, Mode: ref.Mode, RuleSet: ref}
	}
	return core.ProjectionRelayShared, nil
}

type Recovery Module

func (Recovery) Route(ref core.RuleSetRef) (core.RecoveryRoute, error) {
	if ref != relay.LegacyRuleSet() && ref != relay.FixedPointsRuleSet() && ref != relay.EliminationRuleSet() {
		return "", &core.DomainError{Code: core.ErrorInvalidRuleSet, Mode: ref.Mode, RuleSet: ref}
	}
	return core.RecoveryRouteModeOwned, nil
}
