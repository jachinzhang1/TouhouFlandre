package server_test

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay"
	relayadapter "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay/adapter"
)

type mrx005Fixture struct {
	roomID  string
	match   relay.MatchContext
	players []relay.PlayerSnapshot
}

type mrx005Random struct{}

func (mrx005Random) IntN(int) int { return 0 }

type mrx005IDs struct {
	prefix string
	next   atomic.Int64
}

func (i *mrx005IDs) NewID() string {
	return fmt.Sprintf("%s-%d", i.prefix, i.next.Add(1))
}

type mrx005Provisioner struct{}

func (mrx005Provisioner) Provision(_ context.Context, input relay.StageProvisionInput) ([]relay.EncounterSeed, error) {
	seeds := make([]relay.EncounterSeed, 0, len(input.Pairing.Pairs))
	for _, pair := range input.Pairing.Pairs {
		seeds = append(seeds, relay.EncounterSeed{
			EncounterIndex: pair.EncounterIndex,
			AnswerID:       fmt.Sprintf("mrx005-answer-%d-%d", input.StageIndex, pair.EncounterIndex),
			Deadline:       input.StartsAt.Add(5 * time.Minute),
		})
	}
	return seeds, nil
}

type mrx005Scoring struct {
	createNext bool
	calls      atomic.Int32
}

func (s *mrx005Scoring) Settle(input relay.SettlementInput) (relay.SettlementDecision, error) {
	s.calls.Add(1)
	stateByMember := make(map[string]relay.PlayerState, len(input.States))
	for _, state := range input.States {
		stateByMember[state.Player.MemberID] = state
	}
	players := make([]relay.PlayerSettlement, 0, len(input.Participants))
	for _, participant := range input.Participants {
		state := stateByMember[participant.Player.MemberID]
		players = append(players, relay.PlayerSettlement{
			Player: participant.Player, EncounterID: participant.EncounterID,
			Assignment: participant.Assignment, Outcome: participant.Outcome,
			ScoreBefore: state.Score, ScoreAfter: state.Score,
			LifeBefore: state.LifeState, LifeAfter: state.LifeState, LifeTransition: relay.LifeTransitionNone,
			EliminatedStage: state.EliminatedStage,
		})
	}
	decision := relay.SettlementDecision{Players: players, Standings: input.States, CreateNextStage: s.createNext}
	if s.createNext {
		for _, state := range input.States {
			if state.Status == "active" && state.EliminatedStage == nil {
				decision.NextPlayers = append(decision.NextPlayers, state.Player)
			}
		}
		sort.Slice(decision.NextPlayers, func(i, j int) bool { return decision.NextPlayers[i].Seat < decision.NextPlayers[j].Seat })
	}
	return decision, nil
}

type mrx005Clock struct{ value time.Time }

func (c mrx005Clock) Now() time.Time { return c.value }

func TestMRX005StagePlansPersistAndReloadForSupportedRosters(t *testing.T) {
	for _, playerCount := range []int{2, 4, 6, 8} {
		t.Run(fmt.Sprintf("players-%d", playerCount), func(t *testing.T) {
			fixture := createMRX005Fixture(t, playerCount)
			coordinator := newMRX005Coordinator(t, relayadapter.NewStageRepository(pool), fixture, &mrx005Scoring{})
			request := relay.CreateStageRequest{
				Match: fixture.match, StageIndex: 1, ActivePlayers: fixture.players, StartsAt: time.Now().UTC(),
			}
			created, err := coordinator.CreateStage(ctx, request)
			if err != nil {
				t.Fatal(err)
			}
			request.StartsAt = request.StartsAt.Add(time.Hour)
			reloaded, err := coordinator.CreateStage(ctx, request)
			if err != nil {
				t.Fatal(err)
			}
			if !created.Created || reloaded.Created || len(created.Plan.Encounters) != playerCount/2 || !sameMRX005Pairing(created.Plan, reloaded.Plan) {
				t.Fatalf("created=%+v reloaded=%+v", created, reloaded)
			}
			var encounterCount, memberCount int
			if err := pool.QueryRow(ctx, `
				SELECT count(DISTINCT encounter.id)::int, count(member.member_id)::int
				FROM multi_relay_encounter AS encounter
				JOIN multi_relay_encounter_member AS member ON member.encounter_id = encounter.id
				WHERE encounter.stage_id = $1`, created.Plan.StageID).Scan(&encounterCount, &memberCount); err != nil {
				t.Fatal(err)
			}
			if encounterCount != playerCount/2 || memberCount != playerCount {
				t.Fatalf("encounters=%d members=%d", encounterCount, memberCount)
			}
		})
	}
}

func TestMRX005OddRosterPersistsAndRotatesBye(t *testing.T) {
	fixture := createMRX005Fixture(t, 5)
	coordinator := newMRX005Coordinator(t, relayadapter.NewStageRepository(pool), fixture, &mrx005Scoring{createNext: true})
	created, err := coordinator.CreateStage(ctx, relay.CreateStageRequest{
		Match: fixture.match, StageIndex: 1, ActivePlayers: fixture.players, StartsAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.Plan.Bye == nil || len(created.Plan.Encounters) != 2 {
		t.Fatalf("stage one plan=%+v", created.Plan)
	}
	for _, encounter := range created.Plan.Encounters {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if err := endMRX005Encounter(ctx, tx, encounter); err != nil {
			_ = tx.Rollback(ctx)
			t.Fatal(err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
	}
	settled, err := coordinator.TrySettle(ctx, created.Plan.StageID)
	if err != nil {
		t.Fatal(err)
	}
	if settled.NextStage == nil || settled.NextStage.Bye == nil {
		t.Fatalf("settlement did not create an odd next stage: %+v", settled)
	}
	if settled.NextStage.Bye.MemberID == created.Plan.Bye.MemberID {
		t.Fatalf("member %s received consecutive byes", created.Plan.Bye.MemberID)
	}
	var byeRows int
	if err := pool.QueryRow(ctx, `SELECT count(*)::int FROM multi_relay_stage_bye WHERE match_id = $1`, fixture.match.MatchID).Scan(&byeRows); err != nil {
		t.Fatal(err)
	}
	if byeRows != 2 {
		t.Fatalf("persisted bye rows=%d", byeRows)
	}
}

func TestMRX005ConcurrentBarrierHasOneSettlementOwnerAndNextStage(t *testing.T) {
	fixture := createMRX005Fixture(t, 4)
	scoring := &mrx005Scoring{createNext: true}
	coordinator := newMRX005Coordinator(t, relayadapter.NewStageRepository(pool), fixture, scoring)
	created, err := coordinator.CreateStage(ctx, relay.CreateStageRequest{
		Match: fixture.match, StageIndex: 1, ActivePlayers: fixture.players, StartsAt: time.Now().UTC().Add(time.Second),
	})
	if err != nil {
		t.Fatal(err)
	}
	if !created.Created || len(created.Plan.Encounters) != 2 {
		t.Fatalf("created=%+v", created)
	}

	start := make(chan struct{})
	results := make(chan relay.SettlementResult, len(created.Plan.Encounters))
	errorsCh := make(chan error, len(created.Plan.Encounters))
	var wg sync.WaitGroup
	for _, encounter := range created.Plan.Encounters {
		encounter := encounter
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			tx, err := pool.Begin(ctx)
			if err != nil {
				errorsCh <- err
				return
			}
			defer func() { _ = tx.Rollback(ctx) }()
			if _, err := tx.Exec(ctx, `SET LOCAL lock_timeout = '2s'`); err != nil {
				errorsCh <- err
				return
			}
			if err := endMRX005Encounter(ctx, tx, encounter); err != nil {
				errorsCh <- err
				return
			}
			result, err := coordinator.TrySettleInTransaction(ctx, relayadapter.NewStageTransaction(tx), created.Plan.StageID)
			if err != nil {
				errorsCh <- err
				return
			}
			if err := tx.Commit(ctx); err != nil {
				errorsCh <- err
				return
			}
			results <- result
		}()
	}
	close(start)
	wg.Wait()
	close(results)
	close(errorsCh)
	for err := range errorsCh {
		t.Fatal(err)
	}
	owners := 0
	for result := range results {
		if result.Owner {
			owners++
		}
	}
	if owners != 1 || scoring.calls.Load() != 1 {
		t.Fatalf("owners=%d scoringCalls=%d", owners, scoring.calls.Load())
	}
	assertMRX005SettlementState(t, fixture, created.Plan.StageID, 2, 1, 4)
}

func TestMRX005BarrierDoesNotLockSiblingEncounters(t *testing.T) {
	fixture := createMRX005Fixture(t, 4)
	coordinator := newMRX005Coordinator(t, relayadapter.NewStageRepository(pool), fixture, &mrx005Scoring{})
	created, err := coordinator.CreateStage(ctx, relay.CreateStageRequest{
		Match: fixture.match, StageIndex: 1, ActivePlayers: fixture.players, StartsAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	first, second := created.Plan.Encounters[0], created.Plan.Encounters[1]

	holder, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = holder.Rollback(ctx) }()
	if err := endMRX005Encounter(ctx, holder, first); err != nil {
		t.Fatal(err)
	}
	independent, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = independent.Rollback(ctx) }()
	if _, err := independent.Exec(ctx, `SET LOCAL lock_timeout = '250ms'`); err != nil {
		t.Fatal(err)
	}
	if err := endMRX005Encounter(ctx, independent, second); err != nil {
		t.Fatalf("sibling encounter update waited on another unit lock: %v", err)
	}
	if err := independent.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	if err := holder.Rollback(ctx); err != nil {
		t.Fatal(err)
	}

	uncommitted, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = uncommitted.Rollback(ctx) }()
	if err := endMRX005Encounter(ctx, uncommitted, second); err != nil {
		t.Fatal(err)
	}
	probe, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = probe.Rollback(ctx) }()
	if _, err := probe.Exec(ctx, `SET LOCAL lock_timeout = '250ms'`); err != nil {
		t.Fatal(err)
	}
	if err := endMRX005Encounter(ctx, probe, first); err != nil {
		t.Fatal(err)
	}
	result, err := coordinator.TrySettleInTransaction(ctx, relayadapter.NewStageTransaction(probe), created.Plan.StageID)
	if err != nil {
		t.Fatalf("barrier attempted a reverse sibling lock: %v", err)
	}
	if result.Ready {
		t.Fatalf("barrier observed an uncommitted sibling outcome: %+v", result)
	}
}

var errMRX005InjectedFailure = errors.New("mrx005 injected post-event failure")

type mrx005FailingRepository struct {
	base     relay.StageRepository
	failOnce atomic.Bool
}

func (r *mrx005FailingRepository) Transact(ctx context.Context, run func(relay.StageTransaction) error) error {
	return r.base.Transact(ctx, func(tx relay.StageTransaction) error {
		return run(&mrx005FailingTransaction{StageTransaction: tx, failOnce: &r.failOnce})
	})
}

func (r *mrx005FailingRepository) ListSettlementCandidates(ctx context.Context, limit int) ([]string, error) {
	return r.base.ListSettlementCandidates(ctx, limit)
}

type mrx005FailingTransaction struct {
	relay.StageTransaction
	failOnce *atomic.Bool
}

func (t *mrx005FailingTransaction) AppendStageEnded(ctx context.Context, roomID string, event relay.StageEndedEvent) error {
	if err := t.StageTransaction.AppendStageEnded(ctx, roomID, event); err != nil {
		return err
	}
	if t.failOnce.CompareAndSwap(false, true) {
		return errMRX005InjectedFailure
	}
	return nil
}

func TestMRX005SettlementFailureRollsBackAndRecoveryKeepsSequence(t *testing.T) {
	fixture := createMRX005Fixture(t, 4)
	base := relayadapter.NewStageRepository(pool)
	scoring := &mrx005Scoring{createNext: true}
	failing := &mrx005FailingRepository{base: base}
	coordinator := newMRX005Coordinator(t, failing, fixture, scoring)
	created, err := coordinator.CreateStage(ctx, relay.CreateStageRequest{
		Match: fixture.match, StageIndex: 1, ActivePlayers: fixture.players, StartsAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, encounter := range created.Plan.Encounters {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if err := endMRX005Encounter(ctx, tx, encounter); err != nil {
			_ = tx.Rollback(ctx)
			t.Fatal(err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := coordinator.TrySettle(ctx, created.Plan.StageID); !errors.Is(err, errMRX005InjectedFailure) {
		t.Fatalf("settlement error=%v", err)
	}
	assertMRX005SettlementState(t, fixture, created.Plan.StageID, 1, 0, 0)

	recovery := newMRX005Coordinator(t, base, fixture, scoring)
	results, err := recovery.RecoverSettlements(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || !results[0].Owner {
		t.Fatalf("recovery results=%+v", results)
	}
	assertMRX005SettlementState(t, fixture, created.Plan.StageID, 2, 1, 4)

	var sequences []int64
	rows, err := pool.Query(ctx, `SELECT sequence FROM room_event WHERE room_id = $1 ORDER BY sequence`, fixture.roomID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var sequence int64
		if err := rows.Scan(&sequence); err != nil {
			t.Fatal(err)
		}
		sequences = append(sequences, sequence)
	}
	if fmt.Sprint(sequences) != "[1 2 3]" {
		t.Fatalf("event sequences=%v", sequences)
	}
	reloaded, err := recovery.CreateStage(ctx, relay.CreateStageRequest{
		Match: fixture.match, StageIndex: 1, ActivePlayers: fixture.players, StartsAt: time.Now().UTC().Add(time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Created || !sameMRX005Pairing(created.Plan, reloaded.Plan) {
		t.Fatalf("persisted pairing changed: created=%+v reloaded=%+v", created.Plan, reloaded.Plan)
	}
}

func createMRX005Fixture(t *testing.T, playerCount int) mrx005Fixture {
	t.Helper()
	q := repo.New(pool)
	now := time.Now().UTC()
	state, err := q.GetCatalogState(ctx)
	if err != nil {
		t.Fatal(err)
	}
	roomID := multi.NewID()
	room, err := q.CreateRoom(ctx, repo.CreateRoomParams{
		ID: roomID, Code: fmt.Sprintf("M%05d", time.Now().UnixNano()%100000), Format: "bo3", Mode: "relay",
		TurnSeconds: 60, PlayerLimit: 2, ExpiresAt: pgtype.Timestamptz{Time: now.Add(time.Hour), Valid: true},
		QuestionScope: []byte(`{"rules":{},"workIds":[]}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	players := make([]relay.PlayerSnapshot, 0, playerCount)
	for seat := 1; seat <= playerCount; seat++ {
		memberID := multi.NewID()
		if _, err := q.CreateMember(ctx, repo.CreateMemberParams{
			ID: memberID, RoomID: room.ID, Seat: int32(seat), DisplayName: fmt.Sprintf("MRX005 P%d", seat), TokenHash: "mrx005-" + memberID,
		}); err != nil {
			t.Fatal(err)
		}
		players = append(players, relay.PlayerSnapshot{MemberID: memberID, Seat: seat})
	}
	match, err := q.CreateMatch(ctx, repo.CreateMatchParams{
		ID: multi.NewID(), RoomID: room.ID, CatalogVersion: state.CurrentVersion, TargetWins: 1,
		StartedAt: pgtype.Timestamptz{Time: now, Valid: true}, QuestionScope: room.QuestionScope,
		ScoringMode: "wins", RosterSize: int32(playerCount), MaxRounds: 3,
		RuleSetKey: relay.RuleFixedPoints, RuleSetVersion: relay.RuleVersion,
		RuleConfigSnapshot: []byte(`{"mode":"relay","ruleSetKey":"fixed_points","ruleSetVersion":1}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(ctx, `
			UPDATE multi_match
			SET status = 'finished', ended_at = coalesce(ended_at, clock_timestamp())
			WHERE id = $1 AND status = 'playing'`, match.ID); err != nil {
			t.Errorf("finish MRX-005 fixture match: %v", err)
		}
	})
	for _, player := range players {
		if _, err := q.CreateMatchPlayer(ctx, repo.CreateMatchPlayerParams{MatchID: match.ID, MemberID: player.MemberID, Seat: int32(player.Seat)}); err != nil {
			t.Fatal(err)
		}
		if _, err := q.CreateRelayMatchPlayerState(ctx, repo.CreateRelayMatchPlayerStateParams{
			MatchID: match.ID, MemberID: player.MemberID, Score: 0, LifeState: string(relay.LifeStateHealthy),
		}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := q.UpdateRoomStatus(ctx, repo.UpdateRoomStatusParams{
		ID: room.ID, Status: "playing", ExpiresAt: room.ExpiresAt,
	}); err != nil {
		t.Fatal(err)
	}
	return mrx005Fixture{
		roomID: room.ID,
		match: relay.MatchContext{
			MatchID: match.ID, RoomID: room.ID, MatchIndex: int(match.MatchIndex),
			RuleSet: relay.FixedPointsRuleSet(), TargetWins: int(match.TargetWins), MaxStages: int(match.MaxRounds),
		},
		players: players,
	}
}

func newMRX005Coordinator(t *testing.T, repository relay.StageRepository, _ mrx005Fixture, scoring relay.ScoringPolicy) *relay.StageCoordinator {
	t.Helper()
	coordinator, err := relay.NewStageCoordinator(
		repository, relay.RandomPairingPolicy{}, mrx005Provisioner{}, scoring,
		mrx005Clock{value: time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)},
		mrx005Random{}, &mrx005IDs{prefix: "mrx005-" + multi.NewID()}, 5*time.Second,
	)
	if err != nil {
		t.Fatal(err)
	}
	return coordinator
}

func endMRX005Encounter(ctx context.Context, tx pgx.Tx, encounter relay.EncounterPlan) error {
	command, err := tx.Exec(ctx, `
		UPDATE multi_relay_encounter
		SET status = 'ended', winner_member_id = $2, outcome = 'win', ended_at = clock_timestamp()
		WHERE id = $1 AND status <> 'ended'`, encounter.EncounterID, encounter.Members[0].MemberID)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return fmt.Errorf("encounter %s was not ended", encounter.EncounterID)
	}
	return nil
}

func assertMRX005SettlementState(t *testing.T, fixture mrx005Fixture, stageID string, wantStages, wantEndedEvents, wantPlayers int) {
	t.Helper()
	var stages, endedEvents, players int
	var status string
	var marker *string
	if err := pool.QueryRow(ctx, `
		SELECT
			(SELECT count(*)::int FROM multi_relay_stage WHERE match_id = $1),
			(SELECT count(*)::int FROM room_event WHERE room_id = $2 AND type = 'relay.stage.ended'),
			(SELECT count(*)::int FROM multi_relay_stage_player WHERE stage_id = $3),
			stage.status,
			stage.settlement_marker
		FROM multi_relay_stage AS stage
		WHERE stage.id = $3`, fixture.match.MatchID, fixture.roomID, stageID).Scan(&stages, &endedEvents, &players, &status, &marker); err != nil {
		t.Fatal(err)
	}
	if stages != wantStages || endedEvents != wantEndedEvents || players != wantPlayers {
		t.Fatalf("stages=%d events=%d players=%d", stages, endedEvents, players)
	}
	if wantEndedEvents == 0 && (status == "ended" || marker != nil) {
		t.Fatalf("failed settlement leaked status=%s marker=%v", status, marker)
	}
	if wantEndedEvents == 1 && (status != "ended" || marker == nil) {
		t.Fatalf("settled stage status=%s marker=%v", status, marker)
	}
}

func sameMRX005Pairing(left, right relay.StagePlan) bool {
	if left.StageID != right.StageID || len(left.Encounters) != len(right.Encounters) {
		return false
	}
	for index := range left.Encounters {
		if left.Encounters[index].EncounterID != right.Encounters[index].EncounterID || left.Encounters[index].Members != right.Encounters[index].Members {
			return false
		}
	}
	if left.Bye == nil || right.Bye == nil {
		return left.Bye == nil && right.Bye == nil
	}
	return *left.Bye == *right.Bye
}

var _ core.Clock = mrx005Clock{}
