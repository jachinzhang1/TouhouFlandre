package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

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
	domainStates := make([]relaydomain.PlayerState, 0, len(roster))
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
		status := player.Status
		if eliminatedStage != nil {
			status = "eliminated"
		}
		standings = append(standings, openapi.RelayStandingView{
			MemberId: player.MemberID, Seat: int(player.Seat), Score: int(state.Score),
			Status: openapi.MatchPlayerStatus(status), LifeState: openapi.RelayLifeState(state.LifeState),
			EliminatedStage: eliminatedStage,
		})
		domainStates = append(domainStates, relaydomain.PlayerState{
			Player: relaydomain.PlayerSnapshot{MemberID: player.MemberID, Seat: int(player.Seat)},
			Score:  int(state.Score), Status: status, LifeState: relaydomain.LifeState(state.LifeState),
			EliminatedStage: eliminatedStage,
		})
	}
	rosterStatusByMember := make(map[string]string, len(roster))
	for _, player := range roster {
		rosterStatusByMember[player.MemberID] = player.Status
	}
	stages, err := s.q.ListRelayStagesForMatch(ctx, match.ID)
	if err != nil {
		return nil, nil, 0, err
	}
	if len(stages) == 0 {
		return nil, nil, 0, errors.New("relay snapshot: active relay match has no stage")
	}
	fragment := &openapi.RelayMatchFragment{
		RuleSetRef: openapi.RuleSetRef{Mode: openapi.MultiplayerMode(ref.Mode), Key: ref.Key, Version: ref.Version},
		Standings:  standings,
	}
	if ref == relaydomain.FixedPointsRuleSet() {
		plannedStages := int(match.MaxRounds)
		fragment.PlannedStages = &plannedStages
		if match.Status == string(multi.MatchStatusFinished) {
			ranking, _ := relaydomain.FixedPointsRanking(domainStates)
			views := relayRankingViews(ranking)
			fragment.Ranking = &views
		}
	} else if ref == relaydomain.EliminationRuleSet() && match.Status == string(multi.MatchStatusFinished) {
		completedStages := 0
		for _, stage := range stages {
			if stage.Status == string(relaydomain.StageStatusEnded) && int(stage.StageIndex) > completedStages {
				completedStages = int(stage.StageIndex)
			}
		}
		ranking, _, err := relaydomain.EliminationRanking(domainStates, completedStages)
		if err != nil {
			return nil, nil, 0, err
		}
		views := relayRankingViews(ranking)
		fragment.Ranking = &views
	}
	endedStages := make([]repo.MultiRelayStage, 0, len(stages))
	for _, candidate := range stages {
		if candidate.Status == string(relaydomain.StageStatusEnded) {
			endedStages = append(endedStages, candidate)
		}
	}
	if len(endedStages) > 0 {
		historySummary, err := s.buildRelayStageViews(ctx, match, endedStages, observer, rosterStatusByMember, relayStageViewOptions{})
		if err != nil {
			return nil, nil, 0, err
		}
		fragment.HistorySummary = &historySummary
	}

	stage := stages[len(stages)-1]
	stageViews, err := s.buildRelayStageViews(ctx, match, []repo.MultiRelayStage{stage}, observer, rosterStatusByMember, relayStageViewOptions{IncludeDetails: true})
	if err != nil {
		return nil, nil, 0, err
	}
	stageView := stageViews[0]
	fragment.CurrentStage = &stageView

	var legacyRound *openapi.RoundView
	if stageView.EncounterDetails != nil && len(*stageView.EncounterDetails) == 1 && len(roster) == 2 {
		batch, err := s.loadRelayProjectionBatch(ctx, match, []repo.MultiRelayStage{stage}, false)
		if err != nil {
			return nil, nil, 0, err
		}
		encounters := batch.encountersByStageID[stage.ID]
		if len(encounters) == 1 {
			legacyRound = legacyRoundViewFromRelay(match, encounters[0], (*stageView.EncounterDetails)[0], observer)
		}
	}
	return fragment, legacyRound, int(stage.StageIndex), nil
}

type relayStageViewOptions struct {
	IncludeDetails bool
}

type relayProjectionBatch struct {
	encountersByStageID  map[string][]repo.MultiRelayEncounter
	membersByEncounterID map[string][]repo.MultiRelayEncounterMember
	turnsByEncounterID   map[string][]repo.MultiRelayTurn
	settlementsByStageID map[string][]repo.MultiRelayStagePlayer
	byeMemberIDByStageID map[string]string
	charactersByID       map[string]game.Character
	fields               []game.GuessField
	maxTurnsPerPlayer    int
	maxSkipsPerPlayer    int
}

func (s *Server) buildRelayStageViews(ctx context.Context, match repo.MultiMatch, stages []repo.MultiRelayStage, observer repo.MultiMember, rosterStatusByMember map[string]string, options relayStageViewOptions) ([]openapi.RelayStageView, error) {
	if len(stages) == 0 {
		return []openapi.RelayStageView{}, nil
	}
	batch, err := s.loadRelayProjectionBatch(ctx, match, stages, options.IncludeDetails)
	if err != nil {
		return nil, err
	}
	views := make([]openapi.RelayStageView, 0, len(stages))
	for _, stage := range stages {
		encounters := batch.encountersByStageID[stage.ID]
		summaries := make([]openapi.RelayEncounterSummary, 0, len(encounters))
		details := make([]openapi.RelayEncounterView, 0, len(encounters))
		for _, encounter := range encounters {
			members := batch.membersByEncounterID[encounter.ID]
			if len(members) != 2 {
				return nil, fmt.Errorf("relay snapshot: encounter %s has %d members", encounter.ID, len(members))
			}
			summaries = append(summaries, openapi.RelayEncounterSummary{
				EncounterId: encounter.ID, EncounterIndex: int(encounter.EncounterIndex),
				Status: openapi.RelayEncounterSummaryStatus(encounter.Status), Members: relayEncounterMemberViews(members),
			})
			if options.IncludeDetails {
				detail, err := relayEncounterView(encounter, members, batch.turnsByEncounterID[encounter.ID], batch.charactersByID, batch.fields, observer, rosterStatusByMember, batch.maxTurnsPerPlayer, batch.maxSkipsPerPlayer)
				if err != nil {
					return nil, err
				}
				details = append(details, detail)
			}
		}
		stageView := openapi.RelayStageView{
			StageId: stage.ID, StageIndex: int(stage.StageIndex), Status: openapi.RelayStageViewStatus(stage.Status),
			Encounters: summaries,
		}
		if byeMemberID, ok := batch.byeMemberIDByStageID[stage.ID]; ok {
			stageView.ByeMemberId = &byeMemberID
		}
		if settled := relayStageSettlementViews(batch.settlementsByStageID[stage.ID]); len(settled) > 0 {
			stageView.Settlement = &settled
		}
		if options.IncludeDetails {
			stageView.EncounterDetails = &details
		}
		views = append(views, stageView)
	}
	return views, nil
}

func (s *Server) loadRelayProjectionBatch(ctx context.Context, match repo.MultiMatch, stages []repo.MultiRelayStage, includeTurns bool) (relayProjectionBatch, error) {
	batch := relayProjectionBatch{
		encountersByStageID:  map[string][]repo.MultiRelayEncounter{},
		membersByEncounterID: map[string][]repo.MultiRelayEncounterMember{},
		turnsByEncounterID:   map[string][]repo.MultiRelayTurn{},
		settlementsByStageID: map[string][]repo.MultiRelayStagePlayer{},
		byeMemberIDByStageID: map[string]string{},
		fields:               multi.FieldsForMatch(match),
		maxTurnsPerPlayer:    multi.MaxGuessesForMatch(match),
		maxSkipsPerPlayer:    relaydomain.MaxSkipsPerPlayer,
	}
	stageIDs := make([]string, 0, len(stages))
	for _, stage := range stages {
		stageIDs = append(stageIDs, stage.ID)
	}
	if len(stageIDs) == 0 {
		return batch, nil
	}
	encounters, err := s.q.ListRelayEncountersForStages(ctx, repo.ListRelayEncountersForStagesParams{MatchID: match.ID, StageIds: stageIDs})
	if err != nil {
		return batch, err
	}
	for _, encounter := range encounters {
		batch.encountersByStageID[encounter.StageID] = append(batch.encountersByStageID[encounter.StageID], encounter)
	}
	members, err := s.q.ListRelayEncounterMembersForStages(ctx, repo.ListRelayEncounterMembersForStagesParams{MatchID: match.ID, StageIds: stageIDs})
	if err != nil {
		return batch, err
	}
	for _, member := range members {
		batch.membersByEncounterID[member.EncounterID] = append(batch.membersByEncounterID[member.EncounterID], member)
	}
	settlements, err := s.q.ListRelayStagePlayersForStages(ctx, repo.ListRelayStagePlayersForStagesParams{MatchID: match.ID, StageIds: stageIDs})
	if err != nil {
		return batch, err
	}
	for _, settlement := range settlements {
		batch.settlementsByStageID[settlement.StageID] = append(batch.settlementsByStageID[settlement.StageID], settlement)
	}
	byes, err := s.q.ListRelayStageByesForStages(ctx, repo.ListRelayStageByesForStagesParams{MatchID: match.ID, StageIds: stageIDs})
	if err != nil {
		return batch, err
	}
	for _, bye := range byes {
		batch.byeMemberIDByStageID[bye.StageID] = bye.MemberID
	}
	if !includeTurns {
		return batch, nil
	}
	turns, err := s.q.ListRelayTurnsForStages(ctx, repo.ListRelayTurnsForStagesParams{MatchID: match.ID, StageIds: stageIDs})
	if err != nil {
		return batch, err
	}
	for _, turn := range turns {
		batch.turnsByEncounterID[turn.EncounterID] = append(batch.turnsByEncounterID[turn.EncounterID], turn)
	}
	characters, err := multi.CharactersForVersion(ctx, s.q, match.CatalogVersion)
	if err != nil {
		return batch, err
	}
	batch.charactersByID = multi.CharactersByID(characters)
	return batch, nil
}

func relayEncounterView(encounter repo.MultiRelayEncounter, members []repo.MultiRelayEncounterMember, turns []repo.MultiRelayTurn, charactersByID map[string]game.Character, fields []game.GuessField, observer repo.MultiMember, rosterStatusByMember map[string]string, maxTurnsPerPlayer, maxSkipsPerPlayer int) (openapi.RelayEncounterView, error) {
	rows, err := relayTurnRows(turns, members, charactersByID, fields)
	if err != nil {
		return openapi.RelayEncounterView{}, err
	}
	detail := openapi.RelayEncounterView{
		EncounterId: encounter.ID, EncounterIndex: int(encounter.EncounterIndex),
		Status: openapi.RelayEncounterViewStatus(encounter.Status), Members: relayEncounterMemberViews(members),
		Capabilities: relayEncounterCapabilities(encounter, members, observer, rosterStatusByMember),
		Rows:         rows, StartsAt: &encounter.StartsAt.Time, Deadline: &encounter.Deadline.Time,
		MaxTurnsPerPlayer: &maxTurnsPerPlayer, MaxSkipsPerPlayer: &maxSkipsPerPlayer,
	}
	if encounter.TurnMemberID.Valid {
		memberID := encounter.TurnMemberID.String
		seat := relayEncounterSeat(members, memberID)
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
			return openapi.RelayEncounterView{}, errors.New("relay snapshot: answer is absent from the frozen catalog")
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
	return detail, nil
}

func relayEncounterCapabilities(encounter repo.MultiRelayEncounter, members []repo.MultiRelayEncounterMember, observer repo.MultiMember, rosterStatusByMember map[string]string) openapi.RelayEncounterCapabilities {
	if !multi.IsPlayer(observer) || observer.Status == string(multi.MemberStatusLeft) {
		return openapi.RelayEncounterCapabilities{}
	}
	if rosterStatusByMember[observer.ID] != "active" {
		return openapi.RelayEncounterCapabilities{}
	}
	if encounter.Status != string(relaydomain.EncounterStatusPlaying) {
		return openapi.RelayEncounterCapabilities{}
	}
	if !relayEncounterHasMember(members, observer.ID) {
		return openapi.RelayEncounterCapabilities{}
	}
	isTurn := encounter.TurnMemberID.Valid && encounter.TurnMemberID.String == observer.ID
	return openapi.RelayEncounterCapabilities{
		CanGuess:   isTurn,
		CanPass:    isTurn,
		CanForfeit: isTurn,
	}
}

func relayEncounterHasMember(members []repo.MultiRelayEncounterMember, memberID string) bool {
	for _, member := range members {
		if member.MemberID == memberID {
			return true
		}
	}
	return false
}

func relayStageSettlementViews(settled []repo.MultiRelayStagePlayer) []openapi.RelayStageSettlementView {
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
			LifeTransition:  openapi.RelayLifeTransition(relayLifeTransition(player.LifeBefore, player.LifeAfter, player.EliminatedStage.Valid)),
			EliminatedStage: eliminatedStage,
		})
	}
	return rows
}

func relayRankingViews(ranking []relaydomain.RankingEntry) []openapi.RelayRankingView {
	views := make([]openapi.RelayRankingView, 0, len(ranking))
	for _, entry := range ranking {
		views = append(views, openapi.RelayRankingView{
			MemberId: entry.Player.MemberID, Seat: entry.Player.Seat, Rank: entry.Rank,
			Score: entry.Score, Status: openapi.MatchPlayerStatus(entry.Status),
			LifeState: openapi.RelayLifeState(entry.LifeState), EliminatedStage: entry.EliminatedStage,
			SurvivedStages: entry.SurvivedStages,
		})
	}
	return views
}

func relayLifeTransition(before, after string, eliminated bool) relaydomain.LifeTransition {
	if eliminated {
		return relaydomain.LifeTransitionEliminated
	}
	if relaydomain.LifeState(before) == relaydomain.LifeStateHealthy && relaydomain.LifeState(after) == relaydomain.LifeStateNearDeath {
		return relaydomain.LifeTransitionEnteredNearDeath
	}
	return relaydomain.LifeTransitionNone
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
