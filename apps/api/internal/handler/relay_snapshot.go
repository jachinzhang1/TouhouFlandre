package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
	relaydomain "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay"
)

func (s *Server) buildRelaySnapshot(ctx context.Context, match repo.MultiMatch, members []repo.MultiMember, observer repo.MultiMember, ref core.RuleSetRef) (*openapi.RelayMatchFragment, *openapi.RoundView, int, error) {
	roster, err := s.q.ListMatchPlayers(ctx, match.ID)
	if err != nil {
		return nil, nil, 0, err
	}
	states, err := s.q.ListRelayMatchPlayerStates(ctx, match.ID)
	if err != nil {
		return nil, nil, 0, err
	}
	stateByMember := make(map[string]repo.MultiRelayMatchPlayerState, len(states))
	for _, state := range states {
		stateByMember[state.MemberID] = state
	}
	standings := make([]openapi.RelayStandingView, 0, len(roster))
	for _, player := range roster {
		state, ok := stateByMember[player.MemberID]
		if !ok {
			return nil, nil, 0, fmt.Errorf("relay snapshot: missing player state for %s", player.MemberID)
		}
		var eliminatedStage *int
		if state.EliminatedStage.Valid {
			value := int(state.EliminatedStage.Int32)
			eliminatedStage = &value
		}
		standings = append(standings, openapi.RelayStandingView{
			MemberId: player.MemberID, Seat: int(player.Seat), Score: int(state.Score),
			Status: openapi.MatchPlayerStatus(player.Status), LifeState: openapi.RelayLifeState(state.LifeState),
			EliminatedStage: eliminatedStage,
		})
	}
	fragment := &openapi.RelayMatchFragment{
		RuleSetRef: openapi.RuleSetRef{Mode: openapi.MultiplayerMode(ref.Mode), Key: ref.Key, Version: ref.Version},
		Standings:  standings,
	}

	stages, err := s.q.ListRelayStagesForMatch(ctx, match.ID)
	if err != nil {
		return nil, nil, 0, err
	}
	if len(stages) == 0 {
		return nil, nil, 0, errors.New("relay snapshot: active relay match has no stage")
	}
	stage := stages[len(stages)-1]
	encounters, err := s.q.ListRelayEncountersForStage(ctx, stage.ID)
	if err != nil {
		return nil, nil, 0, err
	}
	characters, err := multi.CharactersForVersion(ctx, s.q, match.CatalogVersion)
	if err != nil {
		return nil, nil, 0, err
	}
	charactersByID := multi.CharactersByID(characters)
	fields := multi.FieldsForMatch(match)

	summaries := make([]openapi.RelayEncounterSummary, 0, len(encounters))
	details := make([]openapi.RelayEncounterView, 0, len(encounters))
	for _, encounter := range encounters {
		assigned, err := s.q.ListRelayEncounterMembers(ctx, encounter.ID)
		if err != nil {
			return nil, nil, 0, err
		}
		if len(assigned) != 2 {
			return nil, nil, 0, fmt.Errorf("relay snapshot: encounter %s has %d members", encounter.ID, len(assigned))
		}
		memberViews := relayEncounterMemberViews(assigned)
		turns, err := s.q.ListRelayTurnsForEncounter(ctx, encounter.ID)
		if err != nil {
			return nil, nil, 0, err
		}
		rows, err := relayTurnRows(turns, assigned, charactersByID, fields)
		if err != nil {
			return nil, nil, 0, err
		}
		summaries = append(summaries, openapi.RelayEncounterSummary{
			EncounterId: encounter.ID, EncounterIndex: int(encounter.EncounterIndex),
			Status: openapi.RelayEncounterSummaryStatus(encounter.Status), Members: memberViews,
		})
		maxTurns := multi.MaxGuessesForMatch(match)
		maxSkips := relaydomain.MaxSkipsPerPlayer
		detail := openapi.RelayEncounterView{
			EncounterId: encounter.ID, EncounterIndex: int(encounter.EncounterIndex),
			Status: openapi.RelayEncounterViewStatus(encounter.Status), Members: memberViews, Rows: rows,
			StartsAt: &encounter.StartsAt.Time, Deadline: &encounter.Deadline.Time,
			MaxTurnsPerPlayer: &maxTurns, MaxSkipsPerPlayer: &maxSkips,
		}
		if encounter.TurnMemberID.Valid {
			memberID := encounter.TurnMemberID.String
			seat := relayEncounterSeat(assigned, memberID)
			detail.TurnMemberId = &memberID
			detail.TurnSeat = &seat
		}
		if encounter.TurnDeadline.Valid {
			deadline := encounter.TurnDeadline.Time
			detail.TurnDeadline = &deadline
		}
		if encounter.Status == string(relaydomain.EncounterStatusEnded) {
			answer, ok := charactersByID[encounter.AnswerID]
			if !ok {
				return nil, nil, 0, errors.New("relay snapshot: answer is absent from the frozen catalog")
			}
			visibleAnswer := toOpenAPICharacter(answer)
			detail.Answer = &visibleAnswer
			if encounter.Outcome.Valid {
				outcome := openapi.RelayEncounterViewOutcome(encounter.Outcome.String)
				detail.Outcome = &outcome
			}
			if encounter.WinnerMemberID.Valid {
				winner := encounter.WinnerMemberID.String
				detail.WinnerMemberId = &winner
			}
		}
		details = append(details, detail)
	}

	stageView := openapi.RelayStageView{
		StageId: stage.ID, StageIndex: int(stage.StageIndex), Status: openapi.RelayStageViewStatus(stage.Status),
		Encounters: summaries, EncounterDetails: &details,
	}
	if bye, err := s.q.GetRelayStageBye(ctx, stage.ID); err == nil {
		memberID := bye.MemberID
		stageView.ByeMemberId = &memberID
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, 0, err
	}
	settled, err := s.q.ListRelayStagePlayers(ctx, stage.ID)
	if err != nil {
		return nil, nil, 0, err
	}
	if len(settled) > 0 {
		rows := make([]openapi.RelayStageSettlementView, 0, len(settled))
		for _, player := range settled {
			var encounterID *string
			if player.EncounterID.Valid {
				value := player.EncounterID.String
				encounterID = &value
			}
			var eliminatedStage *int
			if player.EliminatedStage.Valid {
				value := int(player.EliminatedStage.Int32)
				eliminatedStage = &value
			}
			rows = append(rows, openapi.RelayStageSettlementView{
				MemberId: player.MemberID, EncounterId: encounterID,
				Assignment:  openapi.RelayStageSettlementViewAssignment(player.Assignment),
				Outcome:     openapi.RelayStageSettlementViewOutcome(player.Outcome),
				ScoreBefore: int(player.ScoreBefore), ScoreDelta: int(player.ScoreDelta), ScoreAfter: int(player.ScoreAfter),
				LifeBefore: openapi.RelayLifeState(player.LifeBefore), LifeAfter: openapi.RelayLifeState(player.LifeAfter),
				EliminatedStage: eliminatedStage,
			})
		}
		stageView.Settlement = &rows
	}
	fragment.CurrentStage = &stageView

	var legacyRound *openapi.RoundView
	if len(encounters) == 1 && len(roster) == 2 {
		legacyRound = legacyRoundViewFromRelay(match, encounters[0], details[0], observer)
	}
	return fragment, legacyRound, int(stage.StageIndex), nil
}

func relayEncounterMemberViews(members []repo.MultiRelayEncounterMember) []openapi.RelayEncounterMemberView {
	views := make([]openapi.RelayEncounterMemberView, 0, len(members))
	for _, member := range members {
		views = append(views, openapi.RelayEncounterMemberView{
			MemberId: member.MemberID, Seat: int(member.Seat), Side: openapi.RelayEncounterMemberViewSide(member.Side),
		})
	}
	return views
}

func relayTurnRows(turns []repo.MultiRelayTurn, members []repo.MultiRelayEncounterMember, characters map[string]game.Character, fields []game.GuessField) ([]openapi.RelayTurnRow, error) {
	rows := make([]openapi.RelayTurnRow, 0, len(turns))
	for _, turn := range turns {
		row := openapi.RelayTurnRow{
			Index: int(turn.TurnIndex), MemberId: turn.MemberID, Seat: relayEncounterSeat(members, turn.MemberID),
			Kind: openapi.RelayTurnRowKind(turn.Kind),
		}
		if turn.Kind == string(relaydomain.TurnKindGuess) {
			var statuses []string
			if err := json.Unmarshal(turn.Statuses, &statuses); err != nil {
				return nil, err
			}
			character, ok := characters[turn.GuessID.String]
			if !ok {
				return nil, fmt.Errorf("relay snapshot: guess %s is absent from catalog", turn.GuessID.String)
			}
			guess := toOpenAPIGuessResult(multi.HydrateGuessResultWithFields(character, statuses, turn.IsCorrect, fields))
			row.Guess = &guess
		}
		rows = append(rows, row)
	}
	return rows, nil
}

func relayEncounterSeat(members []repo.MultiRelayEncounterMember, memberID string) int {
	for _, member := range members {
		if member.MemberID == memberID {
			return int(member.Seat)
		}
	}
	return 0
}

func legacyRoundViewFromRelay(match repo.MultiMatch, encounter repo.MultiRelayEncounter, detail openapi.RelayEncounterView, observer repo.MultiMember) *openapi.RoundView {
	status := openapi.RoundStatus(encounter.Status)
	if encounter.Status == string(relaydomain.EncounterStatusPlanned) {
		status = openapi.RoundStatusCountdown
	}
	maxTurns := multi.MaxGuessesForMatch(match)
	maxSkips := relaydomain.MaxSkipsPerPlayer
	view := &openapi.RoundView{
		Status: status, StartsAt: encounter.StartsAt.Time, Deadline: encounter.Deadline.Time,
		MaxGuesses: maxTurns, MaxTurnsPerPlayer: &maxTurns, MaxSkipsPerPlayer: &maxSkips,
		Opponents: []openapi.OpponentBoardView{}, TurnMemberId: detail.TurnMemberId,
		TurnSeat: detail.TurnSeat, TurnDeadline: detail.TurnDeadline,
	}
	view.Shared = &struct {
		Rows []openapi.RelayTurnRow `json:"rows"`
	}{Rows: detail.Rows}
	view.Self.Guesses = []openapi.GuessResult{}
	if multi.IsPlayer(observer) {
		memberID := observer.ID
		seat := multi.MemberSeat(observer)
		view.Self.MemberId = &memberID
		view.Self.Seat = &seat
		for _, row := range detail.Rows {
			if row.MemberId == observer.ID && row.Guess != nil {
				view.Self.Guesses = append(view.Self.Guesses, *row.Guess)
			}
		}
	}
	return view
}
