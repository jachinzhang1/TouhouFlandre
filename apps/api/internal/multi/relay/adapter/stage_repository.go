package adapter

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	legacy "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
	relaydomain "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay"
)

type StageRepository struct {
	pool              *pgxpool.Pool
	finishedRetention time.Duration
}

func NewStageRepository(pool *pgxpool.Pool, finishedRetention ...time.Duration) *StageRepository {
	return &StageRepository{pool: pool, finishedRetention: normalizeFinishedRetention(finishedRetention)}
}

func (r *StageRepository) Transact(ctx context.Context, run func(relaydomain.StageTransaction) error) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := run(NewStageTransaction(tx, r.finishedRetention)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *StageRepository) ListSettlementCandidates(ctx context.Context, limit int) ([]string, error) {
	if limit <= 0 {
		limit = 100
	}
	return repo.New(r.pool).ListRelaySettlementCandidates(ctx, int32(limit))
}

func NewStageTransaction(tx pgx.Tx, finishedRetention ...time.Duration) relaydomain.StageTransaction {
	return NewStageTransactionFromQueries(repo.New(tx), finishedRetention...)
}

func NewStageTransactionFromQueries(q *repo.Queries, finishedRetention ...time.Duration) relaydomain.StageTransaction {
	return &stageTransaction{q: q, finishedRetention: normalizeFinishedRetention(finishedRetention)}
}

type stageTransaction struct {
	q                 *repo.Queries
	finishedRetention time.Duration
}

func (t *stageTransaction) FindStage(ctx context.Context, matchID string, stageIndex int, lock bool) (relaydomain.StageRecord, bool, error) {
	params := repo.GetRelayStageByMatchIndexParams{MatchID: matchID, StageIndex: int32(stageIndex)}
	var (
		stage repo.MultiRelayStage
		err   error
	)
	if lock {
		stage, err = t.q.GetRelayStageByMatchIndexForUpdate(ctx, repo.GetRelayStageByMatchIndexForUpdateParams(params))
	} else {
		stage, err = t.q.GetRelayStageByMatchIndex(ctx, params)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return relaydomain.StageRecord{}, false, nil
	}
	if err != nil {
		return relaydomain.StageRecord{}, false, err
	}
	return stageRecord(stage), true, nil
}

func (t *stageTransaction) GetStage(ctx context.Context, stageID string, lock bool) (relaydomain.StageRecord, bool, error) {
	var (
		stage repo.MultiRelayStage
		err   error
	)
	if lock {
		stage, err = t.q.GetRelayStageForUpdate(ctx, stageID)
	} else {
		stage, err = t.q.GetRelayStage(ctx, stageID)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return relaydomain.StageRecord{}, false, nil
	}
	if err != nil {
		return relaydomain.StageRecord{}, false, err
	}
	return stageRecord(stage), true, nil
}

func (t *stageTransaction) LoadStagePlan(ctx context.Context, stageID string) (relaydomain.StagePlan, error) {
	stage, err := t.q.GetRelayStage(ctx, stageID)
	if err != nil {
		return relaydomain.StagePlan{}, err
	}
	match, err := t.q.GetMatchForUpdate(ctx, stage.MatchID)
	if err != nil {
		return relaydomain.StagePlan{}, err
	}
	encounters, err := t.q.ListRelayEncountersForStage(ctx, stageID)
	if err != nil {
		return relaydomain.StagePlan{}, err
	}
	plan := relaydomain.StagePlan{
		StageID:    stage.ID,
		Match:      relaydomain.MatchContext{MatchID: match.ID, RoomID: match.RoomID, MatchIndex: int(match.MatchIndex)},
		StageIndex: int(stage.StageIndex), Status: relaydomain.StageStatus(stage.Status), StartsAt: stage.StartsAt.Time,
		Encounters: make([]relaydomain.EncounterPlan, 0, len(encounters)),
	}
	for _, encounter := range encounters {
		members, err := t.q.ListRelayEncounterMembers(ctx, encounter.ID)
		if err != nil {
			return relaydomain.StagePlan{}, err
		}
		if len(members) != 2 {
			return relaydomain.StagePlan{}, fmt.Errorf("relay stage %s encounter %s has %d members", stageID, encounter.ID, len(members))
		}
		plan.Encounters = append(plan.Encounters, relaydomain.EncounterPlan{
			EncounterID: encounter.ID, EncounterIndex: int(encounter.EncounterIndex), AnswerID: encounter.AnswerID,
			StartsAt: encounter.StartsAt.Time, Deadline: encounter.Deadline.Time,
			Members: [2]relaydomain.PlayerSnapshot{
				{MemberID: members[0].MemberID, Seat: int(members[0].Seat)},
				{MemberID: members[1].MemberID, Seat: int(members[1].Seat)},
			},
		})
		if encounter.TurnMemberID.Valid {
			plan.Encounters[len(plan.Encounters)-1].TurnMemberID = encounter.TurnMemberID.String
		}
		if encounter.TurnDeadline.Valid {
			plan.Encounters[len(plan.Encounters)-1].TurnDeadline = encounter.TurnDeadline.Time
		}
	}
	bye, err := t.q.GetRelayStageBye(ctx, stageID)
	if err == nil {
		plan.Bye = &relaydomain.PlayerSnapshot{MemberID: bye.MemberID, Seat: int(bye.Seat)}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return relaydomain.StagePlan{}, err
	}
	return plan, nil
}

func (t *stageTransaction) CreateStage(ctx context.Context, plan relaydomain.StagePlan) error {
	if err := plan.Validate(); err != nil {
		return err
	}
	if _, err := t.q.CreateRelayStage(ctx, repo.CreateRelayStageParams{
		ID: plan.StageID, MatchID: plan.Match.MatchID, StageIndex: int32(plan.StageIndex),
		Status: string(plan.Status), PlannedEncounterCount: int32(len(plan.Encounters)), StartsAt: timestamptz(plan.StartsAt),
	}); err != nil {
		return err
	}
	for _, encounter := range plan.Encounters {
		status := relaydomain.EncounterStatusPlanned
		turnMember := pgtype.Text{}
		turnDeadline := pgtype.Timestamptz{}
		if encounter.TurnMemberID != "" {
			status = relaydomain.EncounterStatusCountdown
			turnMember = pgtype.Text{String: encounter.TurnMemberID, Valid: true}
			turnDeadline = timestamptz(encounter.TurnDeadline)
		}
		if _, err := t.q.CreateRelayEncounter(ctx, repo.CreateRelayEncounterParams{
			ID: encounter.EncounterID, MatchID: plan.Match.MatchID, StageID: plan.StageID,
			EncounterIndex: int32(encounter.EncounterIndex), Status: string(status),
			AnswerID: encounter.AnswerID, StartsAt: timestamptz(encounter.StartsAt), Deadline: timestamptz(encounter.Deadline),
			TurnMemberID: turnMember, TurnDeadline: turnDeadline,
		}); err != nil {
			return err
		}
		for side, member := range encounter.Members {
			if _, err := t.q.AddRelayEncounterMember(ctx, repo.AddRelayEncounterMemberParams{
				MatchID: plan.Match.MatchID, StageID: plan.StageID, EncounterID: encounter.EncounterID,
				MemberID: member.MemberID, Side: int32(side + 1), Seat: int32(member.Seat),
			}); err != nil {
				return err
			}
		}
	}
	if _, err := t.q.IncrementRelayMatchStageCount(ctx, repo.IncrementRelayMatchStageCountParams{
		MatchID: plan.Match.MatchID, StageIndex: int32(plan.StageIndex),
	}); err != nil {
		return err
	}
	if plan.Bye != nil {
		_, err := t.q.CreateRelayStageBye(ctx, repo.CreateRelayStageByeParams{
			StageID: plan.StageID, MatchID: plan.Match.MatchID, MemberID: plan.Bye.MemberID, Seat: int32(plan.Bye.Seat),
		})
		return err
	}
	return nil
}

func (t *stageTransaction) LockMatch(ctx context.Context, matchID string) (relaydomain.MatchContext, error) {
	match, err := t.q.GetMatchForUpdate(ctx, matchID)
	if err != nil {
		return relaydomain.MatchContext{}, err
	}
	room, err := t.q.GetRoom(ctx, match.RoomID)
	if err != nil {
		return relaydomain.MatchContext{}, err
	}
	if room.Mode != string(legacy.MultiplayerModeRelay) {
		return relaydomain.MatchContext{}, fmt.Errorf("relay stage match %s belongs to mode %s", matchID, room.Mode)
	}
	return relaydomain.MatchContext{
		MatchID: match.ID, RoomID: match.RoomID, MatchIndex: int(match.MatchIndex),
		TargetWins: int(match.TargetWins), MaxStages: int(match.MaxRounds),
	}, nil
}

func (t *stageTransaction) ListEncounterOutcomes(ctx context.Context, stageID string) ([]relaydomain.EncounterOutcome, error) {
	encounters, err := t.q.ListRelayEncountersForStage(ctx, stageID)
	if err != nil {
		return nil, err
	}
	outcomes := make([]relaydomain.EncounterOutcome, 0, len(encounters))
	for _, encounter := range encounters {
		members, err := t.q.ListRelayEncounterMembers(ctx, encounter.ID)
		if err != nil {
			return nil, err
		}
		if len(members) != 2 {
			return nil, fmt.Errorf("relay encounter %s has %d members", encounter.ID, len(members))
		}
		outcome := relaydomain.EncounterOutcome{
			EncounterID: encounter.ID, EncounterIndex: int(encounter.EncounterIndex), Status: relaydomain.EncounterStatus(encounter.Status),
			Members: [2]relaydomain.PlayerSnapshot{
				{MemberID: members[0].MemberID, Seat: int(members[0].Seat)},
				{MemberID: members[1].MemberID, Seat: int(members[1].Seat)},
			},
		}
		if encounter.WinnerMemberID.Valid {
			winner := encounter.WinnerMemberID.String
			outcome.WinnerMemberID = &winner
		}
		outcomes = append(outcomes, outcome)
	}
	return outcomes, nil
}

func (t *stageTransaction) ListPlayerStates(ctx context.Context, matchID string) ([]relaydomain.PlayerState, error) {
	roster, err := t.q.ListMatchPlayers(ctx, matchID)
	if err != nil {
		return nil, err
	}
	relayStates, err := t.q.ListRelayMatchPlayerStates(ctx, matchID)
	if err != nil {
		return nil, err
	}
	statesByMember := make(map[string]repo.MultiRelayMatchPlayerState, len(relayStates))
	for _, state := range relayStates {
		statesByMember[state.MemberID] = state
	}
	states := make([]relaydomain.PlayerState, 0, len(roster))
	for _, player := range roster {
		state, exists := statesByMember[player.MemberID]
		if !exists {
			return nil, fmt.Errorf("relay player state is missing for member %s", player.MemberID)
		}
		view := relaydomain.PlayerState{
			Player: relaydomain.PlayerSnapshot{MemberID: player.MemberID, Seat: int(player.Seat)},
			Score:  int(state.Score), LifeState: relaydomain.LifeState(state.LifeState), Status: player.Status,
		}
		if state.EliminatedStage.Valid {
			stage := int(state.EliminatedStage.Int32)
			view.EliminatedStage = &stage
			view.Status = "eliminated"
		}
		states = append(states, view)
	}
	return states, nil
}

func (t *stageTransaction) InsertSettlement(ctx context.Context, matchID, stageID string, players []relaydomain.PlayerSettlement, settledAt time.Time) error {
	for _, player := range players {
		if _, err := t.q.InsertRelayStagePlayer(ctx, repo.InsertRelayStagePlayerParams{
			MatchID: matchID, StageID: stageID, MemberID: player.Player.MemberID,
			EncounterID: optionalText(player.EncounterID), Assignment: string(player.Assignment), Outcome: string(player.Outcome),
			ScoreBefore: int32(player.ScoreBefore), ScoreDelta: int32(player.ScoreDelta), ScoreAfter: int32(player.ScoreAfter),
			LifeBefore: string(player.LifeBefore), LifeAfter: string(player.LifeAfter),
			EliminatedStage: optionalInt(player.EliminatedStage), SettledAt: timestamptz(settledAt),
		}); err != nil {
			return err
		}
	}
	return nil
}

func (t *stageTransaction) UpdatePlayerStates(ctx context.Context, matchID string, players []relaydomain.PlayerSettlement) error {
	for _, player := range players {
		if _, err := t.q.UpdateRelayMatchPlayerState(ctx, repo.UpdateRelayMatchPlayerStateParams{
			MatchID: matchID, MemberID: player.Player.MemberID, Score: int32(player.ScoreAfter),
			LifeState: string(player.LifeAfter), EliminatedStage: optionalInt(player.EliminatedStage),
		}); err != nil {
			return err
		}
	}
	return nil
}

func (t *stageTransaction) ApplyMatchDecision(ctx context.Context, match relaydomain.MatchContext, decision relaydomain.MatchDecision, now time.Time) error {
	if _, err := t.q.UpdateMatchScore(ctx, repo.UpdateMatchScoreParams{
		ID: match.MatchID, ScoreSlot1: int32(decision.ScoresBySeat[0]), ScoreSlot2: int32(decision.ScoresBySeat[1]),
	}); err != nil {
		return err
	}
	states, err := t.q.ListRelayMatchPlayerStates(ctx, match.MatchID)
	if err != nil {
		return err
	}
	for _, state := range states {
		if _, err := t.q.SyncLegacyRelayPlayerScore(ctx, repo.SyncLegacyRelayPlayerScoreParams{
			MatchID: match.MatchID, MemberID: state.MemberID, Score: state.Score,
		}); err != nil {
			return err
		}
	}
	if !decision.Ended {
		return nil
	}
	if _, err := t.q.EndRaceMatch(ctx, repo.EndRaceMatchParams{
		ID: match.MatchID, EndedAt: timestamptz(now), WinnerMemberID: optionalText(decision.WinnerMemberID),
	}); err != nil {
		return err
	}
	retentionEndsAt := now.Add(t.finishedRetention)
	if _, err := t.q.UpdateRoomStatus(ctx, repo.UpdateRoomStatusParams{
		ID: match.RoomID, Status: string(legacy.RoomStatusFinished), ExpiresAt: timestamptz(retentionEndsAt),
	}); err != nil {
		return err
	}
	scores := make([]legacy.MemberScoreView, 0, len(states))
	var winnerSeat *int
	for _, state := range states {
		player, err := t.q.GetMatchPlayer(ctx, repo.GetMatchPlayerParams{MatchID: match.MatchID, MemberID: state.MemberID})
		if err != nil {
			return err
		}
		if decision.WinnerMemberID != nil && state.MemberID == *decision.WinnerMemberID {
			seat := int(player.Seat)
			winnerSeat = &seat
		}
		scores = append(scores, legacy.MemberScoreView{MemberID: state.MemberID, Seat: int(player.Seat), Score: int(state.Score), Status: player.Status})
	}
	return legacy.AppendEvent(ctx, t.q, match.RoomID, legacy.EventMatchEnded, legacy.MatchEndedEventPayload{
		MatchIndex: match.MatchIndex, WinnerMemberID: decision.WinnerMemberID, WinnerSlot: winnerSeat,
		MemberScores: scores, Scores: legacy.ScoresView{Slot1: decision.ScoresBySeat[0], Slot2: decision.ScoresBySeat[1]},
		Reason: legacy.MatchEndReason(decision.Reason), RetentionEndsAt: retentionEndsAt,
	})
}

func normalizeFinishedRetention(values []time.Duration) time.Duration {
	if len(values) > 0 && values[0] > 0 {
		return values[0]
	}
	return legacy.DefaultTimingConfig().FinishedRetention
}

func (t *stageTransaction) MarkStageSettled(ctx context.Context, stageID, marker string, settledAt time.Time) (bool, error) {
	_, err := t.q.MarkRelayStageSettled(ctx, repo.MarkRelayStageSettledParams{
		ID: stageID, SettledAt: timestamptz(settledAt), SettlementMarker: pgtype.Text{String: marker, Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (t *stageTransaction) AppendStageStarted(ctx context.Context, roomID string, event relaydomain.StageStartedEvent) error {
	encounters := make([]legacy.RelayEncounterSummary, 0, len(event.Encounters))
	for _, encounter := range event.Encounters {
		encounters = append(encounters, legacy.RelayEncounterSummary{
			EncounterID: encounter.EncounterID, EncounterIndex: encounter.EncounterIndex, Status: string(relaydomain.EncounterStatusPlanned),
			Members: []legacy.RelayEncounterMemberView{
				{MemberID: encounter.Members[0].MemberID, Seat: encounter.Members[0].Seat, Side: 1},
				{MemberID: encounter.Members[1].MemberID, Seat: encounter.Members[1].Seat, Side: 2},
			},
		})
	}
	return legacy.AppendEvent(ctx, t.q, roomID, legacy.EventRelayStageStarted, legacy.RelayStageStartedPayload{
		MatchIndex: event.MatchIndex, StageID: event.StageID, StageIndex: event.StageIndex,
		Status: string(event.Status), Encounters: encounters, ByeMemberID: event.ByeMemberID,
	})
}

func (t *stageTransaction) AppendStageEnded(ctx context.Context, roomID string, event relaydomain.StageEndedEvent) error {
	settlement := make([]legacy.RelayStageSettlementView, 0, len(event.Settlement))
	for _, player := range event.Settlement {
		settlement = append(settlement, legacy.RelayStageSettlementView{
			MemberID: player.Player.MemberID, EncounterID: player.EncounterID, Assignment: string(player.Assignment), Outcome: string(player.Outcome),
			ScoreBefore: player.ScoreBefore, ScoreDelta: player.ScoreDelta, ScoreAfter: player.ScoreAfter,
			LifeBefore: legacy.RelayLifeState(player.LifeBefore), LifeAfter: legacy.RelayLifeState(player.LifeAfter),
			EliminatedStage: player.EliminatedStage,
		})
	}
	standings := make([]legacy.RelayStandingView, 0, len(event.Standings))
	for _, state := range event.Standings {
		standings = append(standings, legacy.RelayStandingView{
			MemberID: state.Player.MemberID, Seat: state.Player.Seat, Score: state.Score, Status: state.Status,
			LifeState: legacy.RelayLifeState(state.LifeState), EliminatedStage: state.EliminatedStage,
		})
	}
	return legacy.AppendEvent(ctx, t.q, roomID, legacy.EventRelayStageEnded, legacy.RelayStageEndedPayload{
		MatchIndex: event.MatchIndex, StageID: event.StageID, StageIndex: event.StageIndex, Status: string(relaydomain.StageStatusEnded),
		Settlement: settlement, Standings: standings, NextStageIndex: event.NextStageIndex, ByeMemberID: event.ByeMemberID,
	})
}

func stageRecord(stage repo.MultiRelayStage) relaydomain.StageRecord {
	record := relaydomain.StageRecord{
		StageID: stage.ID, MatchID: stage.MatchID, StageIndex: int(stage.StageIndex), Status: relaydomain.StageStatus(stage.Status),
		PlannedEncounterCount: int(stage.PlannedEncounterCount), StartsAt: stage.StartsAt.Time,
	}
	if stage.SettledAt.Valid {
		value := stage.SettledAt.Time
		record.SettledAt = &value
	}
	if stage.SettlementMarker.Valid {
		value := stage.SettlementMarker.String
		record.SettlementMarker = &value
	}
	return record
}

func timestamptz(value time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: value, Valid: true}
}

func optionalText(value *string) pgtype.Text {
	if value == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *value, Valid: true}
}

func optionalInt(value *int) pgtype.Int4 {
	if value == nil {
		return pgtype.Int4{}
	}
	return pgtype.Int4{Int32: int32(*value), Valid: true}
}
