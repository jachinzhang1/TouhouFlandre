package handler

import (
	"context"
	"net/http"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
)

func modeFromStored(value string) core.Mode { return core.Mode(value) }

func (s *Server) roomPolicyForState(room repo.MultiRoom) (core.RoomPolicy, error) {
	policy, err := s.modeRegistry.RoomPolicy(modeFromStored(room.Mode))
	if err != nil {
		return nil, internalError(err)
	}
	if _, err := policy.PrepareRoom(core.RoomConfig{
		Mode:                   modeFromStored(room.Mode),
		PlayerLimit:            int(room.PlayerLimit),
		RaceEliminationEnabled: room.RaceEliminationEnabled,
		TurnSeconds:            int(room.TurnSeconds),
	}); err != nil {
		return nil, internalError(err)
	}
	return policy, nil
}

func (s *Server) relayRoomConfigForState(ctx context.Context, room repo.MultiRoom, q *repo.Queries) (multi.RelayRoomConfigView, error) {
	return multi.RelayRoomConfigForRoom(ctx, q, room)
}

func (s *Server) ruleSetForState(room repo.MultiRoom, match repo.MultiMatch) (core.RuleSetRef, error) {
	ref, err := multi.ResolveMatchRuleSet(s.modeRegistry, room, match)
	if err != nil {
		return core.RuleSetRef{}, internalError(err)
	}
	return ref, nil
}

func (s *Server) commandRoute(room repo.MultiRoom, match repo.MultiMatch, command core.CommandName, actorID string) (core.CommandRoute, error) {
	ref, err := s.ruleSetForState(room, match)
	if err != nil {
		return "", err
	}
	handler, err := s.modeRegistry.CommandHandler(ref.Mode)
	if err != nil {
		return "", internalError(err)
	}
	result, err := handler.Handle(core.CommandContext{RuleSet: ref, Command: command, ActorID: actorID, Now: s.now()})
	if err != nil {
		if core.HasErrorCode(err, core.ErrorFeatureDisabled) {
			return "", &ApiError{Status: http.StatusNotImplemented, Code: codeFeatureDisabled, Message: err.Error()}
		}
		return "", internalError(err)
	}
	if !result.Accepted {
		return "", internalError(&core.DomainError{Code: core.ErrorUnsupportedCommand, Mode: ref.Mode, RuleSet: ref, Capability: "command_handler"})
	}
	return result.Route, nil
}

func rosterSummary(members []repo.MultiMember) []core.RosterMember {
	roster := make([]core.RosterMember, 0, len(members))
	for _, member := range members {
		roster = append(roster, core.RosterMember{
			Connected: member.Status == "connected",
			Ready:     member.Ready,
			Player:    multi.IsPlayer(member),
			Seat:      multi.MemberSeat(member),
		})
	}
	return roster
}

func rematchRosterSummary(members []repo.MultiMember) []core.RosterMember {
	roster := rosterSummary(members)
	for index := range roster {
		roster[index].Ready = members[index].RematchReady
	}
	return roster
}
