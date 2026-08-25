package adapter

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	legacy "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
	relaydomain "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay"
)

type EncounterAction string

const (
	EncounterActionGuess   EncounterAction = "guess"
	EncounterActionPass    EncounterAction = "pass"
	EncounterActionForfeit EncounterAction = "forfeit"
)

type EncounterActionInput struct {
	RoomID                      string
	StageIndex                  int
	EncounterID                 string
	ActorMemberID               string
	Action                      EncounterAction
	GuessID                     string
	IdempotencyKey              string
	AllowLegacyOutOfTurnForfeit bool
}

type EncounterActionResult struct {
	RoomID      string
	StageIndex  int
	EncounterID string
	Accepted    bool
	Changed     bool
	Turn        *legacy.RelayTurnRow
	Guess       *legacy.GuessResultView
	Ended       bool
}

type EncounterService struct {
	pool              *pgxpool.Pool
	clock             core.Clock
	coordinator       *relaydomain.StageCoordinator
	finishedRetention time.Duration
}

func NewEncounterService(pool *pgxpool.Pool, clock core.Clock, coordinator *relaydomain.StageCoordinator, finishedRetention ...time.Duration) *EncounterService {
	if clock == nil {
		clock = core.SystemClock{}
	}
	return &EncounterService{
		pool: pool, clock: clock, coordinator: coordinator,
		finishedRetention: normalizeFinishedRetention(finishedRetention),
	}
}

func (s *EncounterService) Act(ctx context.Context, input EncounterActionInput) (EncounterActionResult, error) {
	result := EncounterActionResult{RoomID: input.RoomID, StageIndex: input.StageIndex, EncounterID: input.EncounterID}
	if input.RoomID == "" || input.StageIndex < 1 || input.EncounterID == "" || input.ActorMemberID == "" || input.IdempotencyKey == "" {
		return result, fmt.Errorf("%w: incomplete action", relaydomain.ErrInvalidStagePlan)
	}
	if input.Action != EncounterActionGuess && input.Action != EncounterActionPass && input.Action != EncounterActionForfeit {
		return result, fmt.Errorf("%w: unknown action", relaydomain.ErrInvalidStagePlan)
	}
	if (input.Action == EncounterActionGuess) != (input.GuessID != "") {
		return result, fmt.Errorf("%w: guessId does not match action", relaydomain.ErrInvalidStagePlan)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return result, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := repo.New(tx)
	encounter, err := q.GetRelayEncounterTargetForUpdate(ctx, repo.GetRelayEncounterTargetForUpdateParams{
		RoomID: input.RoomID, StageIndex: int32(input.StageIndex), EncounterID: input.EncounterID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return result, relaydomain.ErrEncounterNotFound
	}
	if err != nil {
		return result, err
	}
	match, members, turns, err := loadEncounterContext(ctx, q, encounter)
	if err != nil {
		return result, err
	}
	if err := validateEncounterRuleSet(match); err != nil {
		return result, err
	}
	if !memberAssigned(members, input.ActorMemberID) {
		return result, relaydomain.ErrNotEncounterPlayer
	}

	terminalReplay := encounter.EndedByMemberID.Valid && encounter.EndedByMemberID.String == input.ActorMemberID &&
		encounter.EndIdempotencyKey.Valid && encounter.EndIdempotencyKey.String == input.IdempotencyKey
	if terminalReplay {
		if input.Action != EncounterActionForfeit {
			return result, relaydomain.ErrIdempotencyConflict
		}
		result.Accepted, result.Ended = true, true
		if err := tx.Commit(ctx); err != nil {
			return result, err
		}
		return result, nil
	}
	existing, readErr := q.GetRelayTurnByIdempotencyKey(ctx, repo.GetRelayTurnByIdempotencyKeyParams{
		EncounterID: encounter.ID, MemberID: input.ActorMemberID, IdempotencyKey: input.IdempotencyKey,
	})
	if readErr == nil {
		if input.Action == EncounterActionForfeit || string(input.Action) != existing.Kind || (input.Action == EncounterActionGuess && existing.GuessID.String != input.GuessID) {
			return result, relaydomain.ErrIdempotencyConflict
		}
		row, guess, err := hydrateTurn(ctx, q, match, members, existing)
		if err != nil {
			return result, err
		}
		result.Accepted, result.Turn, result.Guess = true, &row, guess
		result.Ended = encounter.Status == string(relaydomain.EncounterStatusEnded)
		if err := tx.Commit(ctx); err != nil {
			return result, err
		}
		return result, nil
	}
	if !errors.Is(readErr, pgx.ErrNoRows) {
		return result, readErr
	}
	if match.Status != string(legacy.MatchStatusPlaying) {
		return result, relaydomain.ErrEncounterEnded
	}
	if encounter.Status == string(relaydomain.EncounterStatusEnded) {
		return result, relaydomain.ErrEncounterEnded
	}

	now := s.clock.Now()
	if encounter.Status == string(relaydomain.EncounterStatusPlanned) || encounter.Status == string(relaydomain.EncounterStatusCountdown) {
		if now.Before(encounter.StartsAt.Time) {
			return result, relaydomain.ErrEncounterNotActive
		}
		encounter, err = startEncounter(ctx, q, match, encounter, members)
		if err != nil {
			return result, err
		}
	}
	if !now.Before(encounter.Deadline.Time) {
		if err := s.endEncounter(ctx, tx, q, match, encounter, members, turns, relaydomain.DeadlineTransition(), "", "", now); err != nil {
			return result, err
		}
		if err := tx.Commit(ctx); err != nil {
			return result, err
		}
		result.Ended = true
		result.Changed = true
		return result, relaydomain.ErrEncounterEnded
	}

	expiredOwnTurn := false
	for encounter.TurnDeadline.Valid && !now.Before(encounter.TurnDeadline.Time) {
		actor := encounter.TurnMemberID.String
		if actor == input.ActorMemberID {
			expiredOwnTurn = true
		}
		turnSeconds, err := roomTurnSeconds(ctx, q, match.RoomID)
		if err != nil {
			return result, err
		}
		transition, inserted, err := applyStoredTurn(ctx, q, match, encounter, members, turns, relaydomain.Turn{
			ID: legacy.NewID(), Index: len(turns) + 1, MemberID: actor, Kind: relaydomain.TurnKindTimeout,
			IdempotencyKey: "timeout/" + encounter.TurnDeadline.Time.UTC().Format(time.RFC3339Nano),
		}, cappedTurnDeadline(encounter.TurnDeadline.Time.Add(time.Duration(turnSeconds)*time.Second), encounter.Deadline.Time))
		if err != nil {
			return result, err
		}
		turns = append(turns, inserted)
		if err := appendTurnEvent(ctx, q, match, encounter, members, inserted, transition); err != nil {
			return result, err
		}
		if transition.Ended {
			if err := s.endEncounter(ctx, tx, q, match, encounter, members, turns, transition, "", "", now); err != nil {
				return result, err
			}
			if err := tx.Commit(ctx); err != nil {
				return result, err
			}
			result.Ended = true
			result.Changed = true
			return result, relaydomain.ErrEncounterEnded
		}
		encounter.TurnMemberID = pgtype.Text{String: *transition.NextTurnMemberID, Valid: true}
		encounter.TurnDeadline = timestamptz(*transition.NextTurnDeadline)
	}
	if expiredOwnTurn {
		result.Changed = true
		if err := tx.Commit(ctx); err != nil {
			return result, err
		}
		return result, relaydomain.ErrTurnExpired
	}

	state := encounterState(match, encounter, members, turns)
	if input.Action == EncounterActionForfeit {
		var transition relaydomain.Transition
		var err error
		if input.AllowLegacyOutOfTurnForfeit {
			transition, err = relaydomain.ForfeitAssigned(state, input.ActorMemberID)
		} else {
			transition, err = relaydomain.Forfeit(state, input.ActorMemberID)
		}
		if err != nil {
			return result, err
		}
		if err := s.endEncounter(ctx, tx, q, match, encounter, members, turns, transition, input.ActorMemberID, input.IdempotencyKey, now); err != nil {
			return result, err
		}
		if err := tx.Commit(ctx); err != nil {
			return result, err
		}
		result.Accepted, result.Ended = true, true
		result.Changed = true
		return result, nil
	}

	turn := relaydomain.Turn{
		ID: legacy.NewID(), Index: len(turns) + 1, MemberID: input.ActorMemberID,
		Kind: relaydomain.TurnKind(input.Action), GuessID: input.GuessID, IdempotencyKey: input.IdempotencyKey,
	}
	if input.Action == EncounterActionGuess {
		guess, statuses, correct, err := compareGuess(ctx, q, match, encounter.AnswerID, input.GuessID)
		if err != nil {
			return result, err
		}
		turn.Statuses, turn.Correct = statuses, correct
		_ = guess
	}
	turnSeconds, err := roomTurnSeconds(ctx, q, match.RoomID)
	if err != nil {
		return result, err
	}
	nextDeadline := cappedTurnDeadline(now.Add(time.Duration(turnSeconds)*time.Second), encounter.Deadline.Time)
	transition, inserted, err := applyStoredTurn(ctx, q, match, encounter, members, turns, turn, nextDeadline)
	if err != nil {
		return result, err
	}
	turns = append(turns, inserted)
	if err := appendTurnEvent(ctx, q, match, encounter, members, inserted, transition); err != nil {
		return result, err
	}
	if transition.Ended {
		if err := s.endEncounter(ctx, tx, q, match, encounter, members, turns, transition, "", "", now); err != nil {
			return result, err
		}
		result.Ended = true
	}
	row, guess, err := hydrateTurn(ctx, q, match, members, inserted)
	if err != nil {
		return result, err
	}
	result.Accepted, result.Turn, result.Guess = true, &row, guess
	result.Changed = true
	if err := tx.Commit(ctx); err != nil {
		return result, err
	}
	return result, nil
}

func (s *EncounterService) ForfeitMatchMember(ctx context.Context, member repo.MultiMember, reason legacy.MatchEndReason) (bool, error) {
	return s.ForfeitMatchMembers(ctx, []repo.MultiMember{member}, reason)
}

// ForfeitMatchMembers handles relay-owned permanent departure in one
// transaction. Batching gives every member that expired at the same sweeper
// time the same view of the stage, so two players in one encounter become a
// draw instead of whichever row happens to be visited first.
func (s *EncounterService) ForfeitMatchMembers(ctx context.Context, departed []repo.MultiMember, reason legacy.MatchEndReason) (bool, error) {
	if reason != legacy.MatchEndReasonForfeit && reason != legacy.MatchEndReasonDisconnect {
		return false, fmt.Errorf("%w: unsupported forced match-end reason", relaydomain.ErrInvalidStagePlan)
	}
	if len(departed) == 0 {
		return false, nil
	}
	departed = append([]repo.MultiMember(nil), departed...)
	sort.Slice(departed, func(i, j int) bool { return departed[i].ID < departed[j].ID })
	roomID := departed[0].RoomID
	for _, member := range departed {
		if member.RoomID != roomID {
			return false, fmt.Errorf("%w: relay departure batch spans rooms", relaydomain.ErrInvalidStagePlan)
		}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := repo.New(tx)

	activeEncounters, err := q.ListActiveRelayEncountersForRoomForUpdate(ctx, roomID)
	if err != nil {
		return false, err
	}
	match, err := q.GetActiveMatchForUpdate(ctx, roomID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	room, err := q.GetRoom(ctx, roomID)
	if err != nil {
		return false, err
	}
	if room.Mode != string(legacy.MultiplayerModeRelay) {
		return false, tx.Commit(ctx)
	}
	if err := validateEncounterRuleSet(match); err != nil {
		return false, err
	}
	ref := core.RuleSetRef{Mode: core.ModeRelay, Key: match.RuleSetKey, Version: int(match.RuleSetVersion)}

	departedByID := make(map[string]repo.MultiMember, len(departed))
	for _, member := range departed {
		departedByID[member.ID] = member
	}
	openStages, err := q.ListRelayStagesForMatch(ctx, match.ID)
	if err != nil {
		return false, err
	}
	openStageIDs := make([]string, 0, len(openStages))
	departureStage := make(map[string]int, len(departed))
	for _, stage := range openStages {
		if stage.Status == string(relaydomain.StageStatusEnded) {
			continue
		}
		openStageIDs = append(openStageIDs, stage.ID)
		if err := collectDepartureStage(ctx, q, stage, departedByID, departureStage); err != nil {
			return false, err
		}
	}

	now := s.clock.Now()
	roomUpdated := false
	changedPlayers := make([]string, 0, len(departed))
	for _, member := range departed {
		affected, err := q.MarkMatchPlayerLeft(ctx, repo.MarkMatchPlayerLeftParams{MatchID: match.ID, MemberID: member.ID})
		if err != nil {
			return false, err
		}
		if affected > 0 {
			changedPlayers = append(changedPlayers, member.ID)
			if ref == relaydomain.EliminationRuleSet() {
				stageIndex := departureStage[member.ID]
				if stageIndex < 1 {
					return false, fmt.Errorf("%w: departed elimination player has no current stage", relaydomain.ErrInvalidStagePlan)
				}
				if _, err := q.MarkRelayMatchPlayerTerminalStage(ctx, repo.MarkRelayMatchPlayerTerminalStageParams{
					MatchID: match.ID, MemberID: member.ID, StageIndex: pgtype.Int4{Int32: int32(stageIndex), Valid: true},
				}); err != nil {
					return false, err
				}
			}
		}
		if member.Status != string(legacy.MemberStatusLeft) || member.GraceUntil.Valid {
			roomUpdated = true
		}
		if _, err := q.UpdateMemberStatus(ctx, repo.UpdateMemberStatusParams{
			ID: member.ID, Status: string(legacy.MemberStatusLeft), GraceUntil: pgtype.Timestamptz{},
		}); err != nil {
			return false, err
		}
	}
	if roomUpdated {
		membersAfter, err := q.ListMembers(ctx, roomID)
		if err != nil {
			return false, err
		}
		spectators, err := q.CountSpectators(ctx, roomID)
		if err != nil {
			return false, err
		}
		if err := legacy.AppendEvent(ctx, q, roomID, legacy.EventRoomUpdated, legacy.NewRoomUpdatedPayload(room, membersAfter, int(spectators))); err != nil {
			return false, err
		}
	}

	for _, encounter := range activeEncounters {
		loadedMatch, members, turns, err := loadEncounterContext(ctx, q, encounter)
		if err != nil {
			return false, err
		}
		if loadedMatch.ID != match.ID {
			return false, fmt.Errorf("%w: relay departure locked encounter from another match", relaydomain.ErrInvalidStagePlan)
		}
		departedMembers := departedEncounterMembers(members, departedByID)
		if len(departedMembers) == 0 {
			continue
		}
		transition := relaydomain.Transition{Ended: true, Reason: relaydomain.TerminalDraw}
		endedBy := ""
		key := ""
		if len(departedMembers) == 1 {
			var err error
			endedBy = departedMembers[0]
			key = "match-end/" + string(reason) + "/" + endedBy + "/" + encounter.ID
			transition, err = relaydomain.ForfeitAssigned(encounterState(match, encounter, members, turns), endedBy)
			if err != nil {
				return false, err
			}
		}
		var forced *relaydomain.ForcedMatchEnd
		if ref == relaydomain.LegacyRuleSet() {
			forced = &relaydomain.ForcedMatchEnd{WinnerMemberID: transition.WinnerMemberID, Reason: string(reason)}
		}
		if err := s.endEncounterWithMatchEnd(ctx, tx, q, match, encounter, members, turns, transition, endedBy, key, now, forced); err != nil {
			return false, err
		}
	}
	if s.coordinator != nil {
		stageTx := NewStageTransaction(tx, s.finishedRetention)
		for _, stageID := range openStageIDs {
			if _, err := s.coordinator.TrySettleInTransaction(ctx, stageTx, stageID); err != nil {
				return false, err
			}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	for _, memberID := range changedPlayers {
		legacy.DefaultMetrics.IncForfeits(string(reason))
		slog.Info("relay roster member left", "room_id", roomID, "member_id", memberID, "reason", string(reason))
	}
	return true, nil
}

func (s *EncounterService) Sweep(ctx context.Context, limit int) ([]string, error) {
	if limit <= 0 {
		limit = 100
	}
	now := s.clock.Now()
	q := repo.New(s.pool)
	startIDs, err := q.ListRelayEncounterStartCandidates(ctx, repo.ListRelayEncounterStartCandidatesParams{Now: timestamptz(now), CandidateLimit: int32(limit)})
	if err != nil {
		return nil, err
	}
	rooms := map[string]struct{}{}
	for _, id := range startIDs {
		roomID, err := s.startCandidate(ctx, id)
		if err != nil {
			return nil, err
		}
		if roomID != "" {
			rooms[roomID] = struct{}{}
		}
	}
	timeoutIDs, err := q.ListRelayEncounterTimeoutCandidates(ctx, repo.ListRelayEncounterTimeoutCandidatesParams{Now: timestamptz(now), CandidateLimit: int32(limit)})
	if err != nil {
		return nil, err
	}
	for _, id := range timeoutIDs {
		roomID, err := s.timeoutCandidate(ctx, id)
		if err != nil {
			return nil, err
		}
		if roomID != "" {
			rooms[roomID] = struct{}{}
		}
	}
	if s.coordinator != nil {
		settlementRooms, err := s.recoverSettlements(ctx, q, limit)
		if err != nil {
			return nil, err
		}
		for _, roomID := range settlementRooms {
			rooms[roomID] = struct{}{}
		}
	}
	result := make([]string, 0, len(rooms))
	for roomID := range rooms {
		result = append(result, roomID)
	}
	return result, nil
}

func (s *EncounterService) startCandidate(ctx context.Context, encounterID string) (string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := repo.New(tx)
	encounter, err := q.GetRelayEncounterForUpdate(ctx, encounterID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", err
	}
	if encounter.Status != string(relaydomain.EncounterStatusPlanned) && encounter.Status != string(relaydomain.EncounterStatusCountdown) || encounter.StartsAt.Time.After(s.clock.Now()) {
		return "", tx.Commit(ctx)
	}
	match, members, _, err := loadEncounterContext(ctx, q, encounter)
	if err != nil {
		return "", err
	}
	if err := validateEncounterRuleSet(match); err != nil {
		return s.terminateUnrecoverableMatchInTransaction(ctx, tx, q, match, s.clock.Now())
	}
	if _, err := startEncounter(ctx, q, match, encounter, members); err != nil {
		return "", err
	}
	return match.RoomID, tx.Commit(ctx)
}

func (s *EncounterService) timeoutCandidate(ctx context.Context, encounterID string) (string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := repo.New(tx)
	encounter, err := q.GetRelayEncounterForUpdate(ctx, encounterID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", err
	}
	if encounter.Status != string(relaydomain.EncounterStatusPlaying) {
		return "", tx.Commit(ctx)
	}
	match, members, turns, err := loadEncounterContext(ctx, q, encounter)
	if err != nil {
		return "", err
	}
	now := s.clock.Now()
	if err := validateEncounterRuleSet(match); err != nil {
		return s.terminateUnrecoverableMatchInTransaction(ctx, tx, q, match, now)
	}
	if !now.Before(encounter.Deadline.Time) {
		if err := s.endEncounter(ctx, tx, q, match, encounter, members, turns, relaydomain.DeadlineTransition(), "", "", now); err != nil {
			return "", err
		}
		return match.RoomID, tx.Commit(ctx)
	}
	if !encounter.TurnDeadline.Valid || now.Before(encounter.TurnDeadline.Time) {
		return "", tx.Commit(ctx)
	}
	turnSeconds, err := roomTurnSeconds(ctx, q, match.RoomID)
	if err != nil {
		return "", err
	}
	for encounter.TurnDeadline.Valid && !now.Before(encounter.TurnDeadline.Time) {
		transition, inserted, err := applyStoredTurn(ctx, q, match, encounter, members, turns, relaydomain.Turn{
			ID: legacy.NewID(), Index: len(turns) + 1, MemberID: encounter.TurnMemberID.String, Kind: relaydomain.TurnKindTimeout,
			IdempotencyKey: "timeout/" + encounter.TurnDeadline.Time.UTC().Format(time.RFC3339Nano),
		}, cappedTurnDeadline(encounter.TurnDeadline.Time.Add(time.Duration(turnSeconds)*time.Second), encounter.Deadline.Time))
		if err != nil {
			return "", err
		}
		turns = append(turns, inserted)
		if err := appendTurnEvent(ctx, q, match, encounter, members, inserted, transition); err != nil {
			return "", err
		}
		if transition.Ended {
			if err := s.endEncounter(ctx, tx, q, match, encounter, members, turns, transition, "", "", now); err != nil {
				return "", err
			}
			break
		}
		encounter.TurnMemberID = pgtype.Text{String: *transition.NextTurnMemberID, Valid: true}
		encounter.TurnDeadline = timestamptz(*transition.NextTurnDeadline)
	}
	return match.RoomID, tx.Commit(ctx)
}

func (s *EncounterService) recoverSettlements(ctx context.Context, q *repo.Queries, limit int) ([]string, error) {
	stageIDs, err := q.ListRelaySettlementCandidates(ctx, int32(limit))
	if err != nil {
		return nil, err
	}
	roomIDs := make([]string, 0, len(stageIDs))
	for _, stageID := range stageIDs {
		stage, err := q.GetRelayStage(ctx, stageID)
		if err != nil {
			return roomIDs, err
		}
		match, err := q.GetRelayMatch(ctx, stage.MatchID)
		if err != nil {
			return roomIDs, err
		}
		if err := validateEncounterRuleSet(match); err != nil {
			roomID, err := s.terminateUnrecoverableMatch(ctx, match.ID, s.clock.Now())
			if err != nil {
				return roomIDs, err
			}
			if roomID != "" {
				roomIDs = append(roomIDs, roomID)
			}
			continue
		}
		settlement, err := s.coordinator.TrySettle(ctx, stageID)
		if err != nil {
			return roomIDs, err
		}
		stage, err = q.GetRelayStage(ctx, settlement.StageID)
		if err != nil {
			return roomIDs, err
		}
		match, err = q.GetRelayMatch(ctx, stage.MatchID)
		if err != nil {
			return roomIDs, err
		}
		roomIDs = append(roomIDs, match.RoomID)
	}
	return roomIDs, nil
}

func (s *EncounterService) terminateUnrecoverableMatch(ctx context.Context, matchID string, now time.Time) (string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := repo.New(tx)
	match, err := q.GetMatchForUpdate(ctx, matchID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", tx.Commit(ctx)
	}
	if err != nil {
		return "", err
	}
	return s.terminateUnrecoverableMatchInTransaction(ctx, tx, q, match, now)
}

func (s *EncounterService) terminateUnrecoverableMatchInTransaction(ctx context.Context, tx pgx.Tx, q *repo.Queries, match repo.MultiMatch, now time.Time) (string, error) {
	locked, err := q.GetMatchForUpdate(ctx, match.ID)
	if err != nil {
		return "", err
	}
	if locked.Status != string(legacy.MatchStatusPlaying) {
		return locked.RoomID, tx.Commit(ctx)
	}
	activeEncounters, err := q.ListActiveRelayEncountersForRoomForUpdate(ctx, locked.RoomID)
	if err != nil {
		return "", err
	}
	for _, encounter := range activeEncounters {
		if encounter.MatchID != locked.ID {
			continue
		}
		if _, err := q.EndRelayEncounter(ctx, repo.EndRelayEncounterParams{
			ID: encounter.ID, WinnerMemberID: pgtype.Text{},
			Outcome: pgtype.Text{String: string(relaydomain.TerminalServerRestart), Valid: true},
			EndedAt: timestamptz(now),
		}); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return "", err
		}
	}
	if _, err := q.EndRaceMatch(ctx, repo.EndRaceMatchParams{
		ID: locked.ID, EndedAt: timestamptz(now), WinnerMemberID: pgtype.Text{},
	}); err != nil {
		return "", err
	}
	retentionEndsAt := now.Add(s.finishedRetention)
	if _, err := q.UpdateRoomStatus(ctx, repo.UpdateRoomStatusParams{
		ID: locked.RoomID, Status: string(legacy.RoomStatusFinished), ExpiresAt: timestamptz(retentionEndsAt),
	}); err != nil {
		return "", err
	}
	scores, err := relayMemberScores(ctx, q, locked.ID)
	if err != nil {
		return "", err
	}
	if err := legacy.AppendEvent(ctx, q, locked.RoomID, legacy.EventMatchEnded, legacy.MatchEndedEventPayload{
		MatchIndex: int(locked.MatchIndex), WinnerMemberID: nil, MemberScores: scores,
		Scores: legacy.ScoresView{Slot1: int(locked.ScoreSlot1), Slot2: int(locked.ScoreSlot2)},
		Reason: legacy.MatchEndReasonServerRestart, RetentionEndsAt: retentionEndsAt,
	}); err != nil {
		return "", err
	}
	return locked.RoomID, tx.Commit(ctx)
}

func relayMemberScores(ctx context.Context, q *repo.Queries, matchID string) ([]legacy.MemberScoreView, error) {
	players, err := q.ListMatchPlayers(ctx, matchID)
	if err != nil {
		return nil, err
	}
	states, err := q.ListRelayMatchPlayerStates(ctx, matchID)
	if err != nil {
		return nil, err
	}
	relayScores := make(map[string]int, len(states))
	for _, state := range states {
		relayScores[state.MemberID] = int(state.Score)
	}
	scores := make([]legacy.MemberScoreView, 0, len(players))
	for _, player := range players {
		score := int(player.Score)
		if relayScore, ok := relayScores[player.MemberID]; ok {
			score = relayScore
		}
		scores = append(scores, legacy.MemberScoreView{
			MemberID: player.MemberID, Seat: int(player.Seat), Score: score, Status: player.Status,
		})
	}
	return scores, nil
}

func (s *EncounterService) endEncounter(ctx context.Context, tx pgx.Tx, q *repo.Queries, match repo.MultiMatch, encounter repo.MultiRelayEncounter, members []repo.MultiRelayEncounterMember, turns []repo.MultiRelayTurn, transition relaydomain.Transition, endedBy, idempotencyKey string, now time.Time) error {
	return s.endEncounterWithMatchEnd(ctx, tx, q, match, encounter, members, turns, transition, endedBy, idempotencyKey, now, nil)
}

func (s *EncounterService) endEncounterWithMatchEnd(ctx context.Context, tx pgx.Tx, q *repo.Queries, match repo.MultiMatch, encounter repo.MultiRelayEncounter, members []repo.MultiRelayEncounterMember, turns []repo.MultiRelayTurn, transition relaydomain.Transition, endedBy, idempotencyKey string, now time.Time, forced *relaydomain.ForcedMatchEnd) error {
	if !transition.Ended {
		return fmt.Errorf("%w: non-terminal transition", relaydomain.ErrInvalidStagePlan)
	}
	if _, err := q.EndRelayEncounter(ctx, repo.EndRelayEncounterParams{
		ID: encounter.ID, WinnerMemberID: optionalText(transition.WinnerMemberID), Outcome: pgtype.Text{String: string(transition.Reason), Valid: true},
		EndedAt: timestamptz(now), EndedByMemberID: optionalText(nonEmptyPointer(endedBy)), EndIdempotencyKey: optionalText(nonEmptyPointer(idempotencyKey)),
	}); err != nil {
		return err
	}
	characters, err := legacy.CharactersForVersion(ctx, q, match.CatalogVersion)
	if err != nil {
		return err
	}
	answer, ok := legacy.CharactersByID(characters)[encounter.AnswerID]
	if !ok {
		return errors.New("relay encounter answer is absent from the frozen catalog")
	}
	rows, err := hydrateTurns(ctx, q, match, members, turns)
	if err != nil {
		return err
	}
	index, err := stageIndex(ctx, q, encounter.StageID)
	if err != nil {
		return err
	}
	if err := legacy.AppendEvent(ctx, q, match.RoomID, legacy.EventRelayEncounterEnded, legacy.RelayEncounterEndedPayload{
		MatchIndex: int(match.MatchIndex), StageID: encounter.StageID, StageIndex: index,
		EncounterID: encounter.ID, Status: string(relaydomain.EncounterStatusEnded), Outcome: string(transition.Reason),
		WinnerMemberID: transition.WinnerMemberID, Answer: legacy.AnswerViewForCharacter(answer), Turns: rows,
	}); err != nil {
		return err
	}
	if s.coordinator != nil {
		stageTx := NewStageTransaction(tx, s.finishedRetention)
		if forced != nil {
			_, err = s.coordinator.TrySettleForMatchEndInTransaction(ctx, stageTx, encounter.StageID, *forced)
		} else {
			_, err = s.coordinator.TrySettleInTransaction(ctx, stageTx, encounter.StageID)
		}
		return err
	}
	if forced != nil {
		return fmt.Errorf("%w: forced match end requires a coordinator", relaydomain.ErrInvalidStagePlan)
	}
	return nil
}

func loadEncounterContext(ctx context.Context, q *repo.Queries, encounter repo.MultiRelayEncounter) (repo.MultiMatch, []repo.MultiRelayEncounterMember, []repo.MultiRelayTurn, error) {
	match, err := q.GetRelayMatch(ctx, encounter.MatchID)
	if err != nil {
		return repo.MultiMatch{}, nil, nil, err
	}
	members, err := q.ListRelayEncounterMembers(ctx, encounter.ID)
	if err != nil {
		return repo.MultiMatch{}, nil, nil, err
	}
	if len(members) != 2 {
		return repo.MultiMatch{}, nil, nil, fmt.Errorf("relay encounter %s has %d members", encounter.ID, len(members))
	}
	turns, err := q.ListRelayTurnsForEncounter(ctx, encounter.ID)
	return match, members, turns, err
}

func validateEncounterRuleSet(match repo.MultiMatch) error {
	ref := core.RuleSetRef{Mode: core.ModeRelay, Key: match.RuleSetKey, Version: int(match.RuleSetVersion)}
	if match.RuleSetKey == "" || match.RuleSetVersion < 1 {
		return &core.DomainError{Code: core.ErrorMissingRuleSet, Mode: core.ModeRelay, RuleSet: ref}
	}
	switch match.RuleSetKey {
	case relaydomain.RuleLegacyWins, relaydomain.RuleFixedPoints, relaydomain.RuleElimination:
	default:
		return &core.DomainError{Code: core.ErrorUnknownRuleSetKey, Mode: core.ModeRelay, RuleSet: ref}
	}
	if match.RuleSetVersion != relaydomain.RuleVersion {
		return &core.DomainError{Code: core.ErrorUnknownRuleSetVersion, Mode: core.ModeRelay, RuleSet: ref}
	}
	return nil
}

func startEncounter(ctx context.Context, q *repo.Queries, match repo.MultiMatch, encounter repo.MultiRelayEncounter, members []repo.MultiRelayEncounterMember) (repo.MultiRelayEncounter, error) {
	started, err := q.StartRelayEncounter(ctx, encounter.ID)
	if err != nil {
		return repo.MultiRelayEncounter{}, err
	}
	if _, err := q.MarkRelayStagePlaying(ctx, encounter.StageID); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return repo.MultiRelayEncounter{}, err
	}
	turnSeat := memberSeat(members, started.TurnMemberID.String)
	index, err := stageIndex(ctx, q, started.StageID)
	if err != nil {
		return repo.MultiRelayEncounter{}, err
	}
	return started, legacy.AppendEvent(ctx, q, match.RoomID, legacy.EventRelayEncounterStarted, legacy.RelayEncounterStartedPayload{
		MatchIndex: int(match.MatchIndex), StageID: started.StageID, StageIndex: index,
		EncounterID: started.ID, EncounterIndex: int(started.EncounterIndex), Status: started.Status,
		Members: memberViews(members), StartsAt: &started.StartsAt.Time, Deadline: &started.Deadline.Time,
		TurnMemberID: &started.TurnMemberID.String, TurnSeat: &turnSeat, TurnDeadline: &started.TurnDeadline.Time,
		MaxTurnsPerPlayer: legacy.MaxGuessesForMatch(match), MaxSkipsPerPlayer: relaydomain.MaxSkipsPerPlayer,
	})
}

func applyStoredTurn(ctx context.Context, q *repo.Queries, match repo.MultiMatch, encounter repo.MultiRelayEncounter, members []repo.MultiRelayEncounterMember, stored []repo.MultiRelayTurn, turn relaydomain.Turn, nextDeadline time.Time) (relaydomain.Transition, repo.MultiRelayTurn, error) {
	state := encounterState(match, encounter, members, stored)
	transition, err := relaydomain.ApplyTurn(state, turn, nextDeadline)
	if err != nil {
		return relaydomain.Transition{}, repo.MultiRelayTurn{}, err
	}
	statuses, err := json.Marshal(turn.Statuses)
	if err != nil {
		return relaydomain.Transition{}, repo.MultiRelayTurn{}, err
	}
	if turn.Kind != relaydomain.TurnKindGuess {
		statuses = nil
	}
	inserted, err := q.InsertRelayTurn(ctx, repo.InsertRelayTurnParams{
		ID: turn.ID, MatchID: encounter.MatchID, StageID: encounter.StageID, EncounterID: encounter.ID,
		MemberID: turn.MemberID, TurnIndex: int32(turn.Index), Kind: string(turn.Kind), GuessID: optionalText(nonEmptyPointer(turn.GuessID)),
		Statuses: statuses, IsCorrect: turn.Correct, IdempotencyKey: turn.IdempotencyKey,
	})
	if err != nil {
		return relaydomain.Transition{}, repo.MultiRelayTurn{}, err
	}
	if !transition.Ended {
		if _, err := q.UpdateRelayEncounterTurn(ctx, repo.UpdateRelayEncounterTurnParams{
			ID: encounter.ID, TurnMemberID: pgtype.Text{String: *transition.NextTurnMemberID, Valid: true}, TurnDeadline: timestamptz(*transition.NextTurnDeadline),
		}); err != nil {
			return relaydomain.Transition{}, repo.MultiRelayTurn{}, err
		}
	}
	return transition, inserted, nil
}

func appendTurnEvent(ctx context.Context, q *repo.Queries, match repo.MultiMatch, encounter repo.MultiRelayEncounter, members []repo.MultiRelayEncounterMember, turn repo.MultiRelayTurn, transition relaydomain.Transition) error {
	row, _, err := hydrateTurn(ctx, q, match, members, turn)
	if err != nil {
		return err
	}
	var nextSeat *int
	if transition.NextTurnMemberID != nil {
		seat := memberSeat(members, *transition.NextTurnMemberID)
		nextSeat = &seat
	}
	eventType := legacy.EventRelayEncounterTurnGuess
	if turn.Kind == string(relaydomain.TurnKindPass) {
		eventType = legacy.EventRelayEncounterTurnPass
	} else if turn.Kind == string(relaydomain.TurnKindTimeout) {
		eventType = legacy.EventRelayEncounterTurnTimeout
	}
	index, err := stageIndex(ctx, q, encounter.StageID)
	if err != nil {
		return err
	}
	return legacy.AppendEvent(ctx, q, match.RoomID, eventType, legacy.RelayEncounterTurnPayload{
		MatchIndex: int(match.MatchIndex), StageID: encounter.StageID, StageIndex: index,
		EncounterID: encounter.ID, MemberID: turn.MemberID, Row: row,
		NextTurnMemberID: transition.NextTurnMemberID, NextTurnSeat: nextSeat, NextTurnDeadline: transition.NextTurnDeadline,
	})
}

func encounterState(match repo.MultiMatch, encounter repo.MultiRelayEncounter, members []repo.MultiRelayEncounterMember, turns []repo.MultiRelayTurn) relaydomain.EncounterState {
	state := relaydomain.EncounterState{
		ID: encounter.ID, Status: relaydomain.EncounterStatus(encounter.Status), Members: memberSnapshots(members),
		TurnMemberID: encounter.TurnMemberID.String, TurnDeadline: encounter.TurnDeadline.Time, Deadline: encounter.Deadline.Time,
		MaxTurnsPerPlayer: legacy.MaxGuessesForMatch(match), Turns: make([]relaydomain.Turn, 0, len(turns)),
	}
	for _, row := range turns {
		var statuses []string
		if len(row.Statuses) > 0 {
			_ = json.Unmarshal(row.Statuses, &statuses)
		}
		state.Turns = append(state.Turns, relaydomain.Turn{
			ID: row.ID, Index: int(row.TurnIndex), MemberID: row.MemberID, Kind: relaydomain.TurnKind(row.Kind),
			GuessID: row.GuessID.String, Statuses: statuses, Correct: row.IsCorrect, IdempotencyKey: row.IdempotencyKey,
		})
	}
	return state
}

func compareGuess(ctx context.Context, q *repo.Queries, match repo.MultiMatch, answerID, guessID string) (game.Character, []string, bool, error) {
	characters, err := legacy.CharactersForVersion(ctx, q, match.CatalogVersion)
	if err != nil {
		return game.Character{}, nil, false, err
	}
	byID := legacy.CharactersByID(characters)
	guess, ok := byID[guessID]
	if !ok || !guess.EnabledAsGuess {
		return game.Character{}, nil, false, relaydomain.ErrInvalidGuess
	}
	answer, ok := byID[answerID]
	if !ok {
		return game.Character{}, nil, false, errors.New("relay answer is absent from the frozen catalog")
	}
	feedback := game.CompareCharacter(guess, answer, legacy.FieldsForMatch(match))
	statuses := make([]string, len(feedback.Feedback))
	for index, field := range feedback.Feedback {
		statuses[index] = string(field.Status)
	}
	return guess, statuses, guess.ID == answer.ID, nil
}

func hydrateTurn(ctx context.Context, q *repo.Queries, match repo.MultiMatch, members []repo.MultiRelayEncounterMember, turn repo.MultiRelayTurn) (legacy.RelayTurnRow, *legacy.GuessResultView, error) {
	row := legacy.RelayTurnRow{Index: int(turn.TurnIndex), MemberID: turn.MemberID, Seat: memberSeat(members, turn.MemberID), Kind: legacy.RelayTurnKind(turn.Kind)}
	if turn.Kind != string(relaydomain.TurnKindGuess) {
		return row, nil, nil
	}
	var statuses []string
	if err := json.Unmarshal(turn.Statuses, &statuses); err != nil {
		return legacy.RelayTurnRow{}, nil, err
	}
	characters, err := legacy.CharactersForVersion(ctx, q, match.CatalogVersion)
	if err != nil {
		return legacy.RelayTurnRow{}, nil, err
	}
	guess, ok := legacy.CharactersByID(characters)[turn.GuessID.String]
	if !ok {
		return legacy.RelayTurnRow{}, nil, fmt.Errorf("relay guess %s is absent from catalog", turn.GuessID.String)
	}
	hydrated := legacy.HydrateGuessResultViewWithFields(guess, statuses, turn.IsCorrect, legacy.FieldsForMatch(match))
	row.Guess = &hydrated
	return row, &hydrated, nil
}

func hydrateTurns(ctx context.Context, q *repo.Queries, match repo.MultiMatch, members []repo.MultiRelayEncounterMember, turns []repo.MultiRelayTurn) ([]legacy.RelayTurnRow, error) {
	result := make([]legacy.RelayTurnRow, 0, len(turns))
	for _, turn := range turns {
		row, _, err := hydrateTurn(ctx, q, match, members, turn)
		if err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, nil
}

func memberAssigned(members []repo.MultiRelayEncounterMember, memberID string) bool {
	return len(members) == 2 && (members[0].MemberID == memberID || members[1].MemberID == memberID)
}

func departedEncounterMembers(members []repo.MultiRelayEncounterMember, departed map[string]repo.MultiMember) []string {
	result := make([]string, 0, len(members))
	for _, member := range members {
		if _, ok := departed[member.MemberID]; ok {
			result = append(result, member.MemberID)
		}
	}
	sort.Strings(result)
	return result
}

func collectDepartureStage(ctx context.Context, q *repo.Queries, stage repo.MultiRelayStage, departed map[string]repo.MultiMember, target map[string]int) error {
	encounters, err := q.ListRelayEncountersForStage(ctx, stage.ID)
	if err != nil {
		return err
	}
	for _, encounter := range encounters {
		members, err := q.ListRelayEncounterMembers(ctx, encounter.ID)
		if err != nil {
			return err
		}
		for _, member := range members {
			if _, ok := departed[member.MemberID]; ok {
				target[member.MemberID] = int(stage.StageIndex)
			}
		}
	}
	bye, err := q.GetRelayStageBye(ctx, stage.ID)
	if err == nil {
		if _, ok := departed[bye.MemberID]; ok {
			target[bye.MemberID] = int(stage.StageIndex)
		}
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	return err
}

func memberSnapshots(members []repo.MultiRelayEncounterMember) [2]relaydomain.PlayerSnapshot {
	return [2]relaydomain.PlayerSnapshot{{MemberID: members[0].MemberID, Seat: int(members[0].Seat)}, {MemberID: members[1].MemberID, Seat: int(members[1].Seat)}}
}

func memberViews(members []repo.MultiRelayEncounterMember) []legacy.RelayEncounterMemberView {
	result := make([]legacy.RelayEncounterMemberView, 0, len(members))
	for _, member := range members {
		result = append(result, legacy.RelayEncounterMemberView{MemberID: member.MemberID, Seat: int(member.Seat), Side: int(member.Side)})
	}
	return result
}

func memberSeat(members []repo.MultiRelayEncounterMember, memberID string) int {
	for _, member := range members {
		if member.MemberID == memberID {
			return int(member.Seat)
		}
	}
	return 0
}

func roomTurnSeconds(ctx context.Context, q *repo.Queries, roomID string) (int, error) {
	room, err := q.GetRoom(ctx, roomID)
	if err != nil {
		return 0, err
	}
	if room.TurnSeconds <= 0 {
		return int(legacy.DefaultTimingConfig().TurnSeconds / time.Second), nil
	}
	return int(room.TurnSeconds), nil
}

func stageIndex(ctx context.Context, q *repo.Queries, stageID string) (int, error) {
	stage, err := q.GetRelayStage(ctx, stageID)
	if err != nil {
		return 0, err
	}
	return int(stage.StageIndex), nil
}

func cappedTurnDeadline(candidate, encounterDeadline time.Time) time.Time {
	if candidate.After(encounterDeadline) {
		return encounterDeadline
	}
	return candidate
}

func nonEmptyPointer(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

type EncounterProvisioner struct {
	pool     *pgxpool.Pool
	random   core.RandomSource
	duration time.Duration
}

func NewEncounterProvisioner(pool *pgxpool.Pool, random core.RandomSource, duration time.Duration) *EncounterProvisioner {
	return &EncounterProvisioner{pool: pool, random: random, duration: duration}
}

func (p *EncounterProvisioner) Provision(ctx context.Context, input relaydomain.StageProvisionInput) ([]relaydomain.EncounterSeed, error) {
	if len(input.CandidateAnswerIDs) == 0 {
		q := repo.New(p.pool)
		match, err := q.GetRelayMatch(ctx, input.Match.MatchID)
		if err != nil {
			return nil, err
		}
		characters, err := legacy.CharactersForVersion(ctx, q, match.CatalogVersion)
		if err != nil {
			return nil, err
		}
		input.CandidateAnswerIDs = legacy.AnswerPoolForMatch(match, characters)
		input.UsedAnswerIDs, err = q.ListRelayUsedAnswerIDs(ctx, match.ID)
		if err != nil {
			return nil, err
		}
		input.TurnSeconds, err = roomTurnSeconds(ctx, q, match.RoomID)
		if err != nil {
			return nil, err
		}
	}
	if input.EncounterDuration <= 0 {
		input.EncounterDuration = p.duration
	}
	return (relaydomain.QuestionProvisioner{Random: p.random}).Provision(ctx, input)
}
