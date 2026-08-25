package relay_test

import (
	"context"
	"testing"
	"time"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay"
)

type unusedRepository struct{}

func (unusedRepository) Transact(context.Context, func(relay.StageTransaction) error) error {
	panic("not used")
}

func (unusedRepository) ListSettlementCandidates(context.Context, int) ([]string, error) {
	panic("not used")
}

type unusedProvisioner struct{}

func (unusedProvisioner) Provision(context.Context, relay.StageProvisionInput) ([]relay.EncounterSeed, error) {
	panic("not used")
}

type captureScoring struct {
	input relay.SettlementInput
	calls int
}

func (s *captureScoring) Settle(input relay.SettlementInput) (relay.SettlementDecision, error) {
	s.input = input
	s.calls++
	players := make([]relay.PlayerSettlement, 0, len(input.Participants))
	states := make(map[string]relay.PlayerState, len(input.States))
	for _, state := range input.States {
		states[state.Player.MemberID] = state
	}
	for _, participant := range input.Participants {
		state := states[participant.Player.MemberID]
		players = append(players, relay.PlayerSettlement{
			Player: participant.Player, EncounterID: participant.EncounterID,
			Assignment: participant.Assignment, Outcome: participant.Outcome,
			ScoreBefore: state.Score, ScoreAfter: state.Score,
			LifeBefore: state.LifeState, LifeAfter: state.LifeState, LifeTransition: relay.LifeTransitionNone,
		})
	}
	return relay.SettlementDecision{Players: players, Standings: input.States}, nil
}

type fixedClock struct{ now time.Time }

func (c fixedClock) Now() time.Time { return c.now }

type fixedIDs struct{ value string }

func (i fixedIDs) NewID() string { return i.value }

type captureStageTx struct {
	stage       relay.StageRecord
	plan        relay.StagePlan
	outcomes    []relay.EncounterOutcome
	states      []relay.PlayerState
	inserted    []relay.PlayerSettlement
	updated     []relay.PlayerSettlement
	endedEvents int
	marked      bool
	matchLocks  int
}

func (t *captureStageTx) FindStage(context.Context, string, int, bool) (relay.StageRecord, bool, error) {
	return relay.StageRecord{}, false, nil
}

func (t *captureStageTx) GetStage(context.Context, string, bool) (relay.StageRecord, bool, error) {
	return t.stage, true, nil
}

func (t *captureStageTx) LoadStagePlan(context.Context, string) (relay.StagePlan, error) {
	return t.plan, nil
}

func (t *captureStageTx) CreateStage(context.Context, relay.StagePlan) error { return nil }

func (t *captureStageTx) LockMatch(context.Context, string) (relay.MatchContext, error) {
	t.matchLocks++
	return t.plan.Match, nil
}

func (t *captureStageTx) ListEncounterOutcomes(context.Context, string) ([]relay.EncounterOutcome, error) {
	return t.outcomes, nil
}

func (t *captureStageTx) ListPlayerStates(context.Context, string) ([]relay.PlayerState, error) {
	return t.states, nil
}

func (t *captureStageTx) InsertSettlement(_ context.Context, _, _ string, players []relay.PlayerSettlement, _ time.Time) error {
	t.inserted = append([]relay.PlayerSettlement(nil), players...)
	return nil
}

func (t *captureStageTx) UpdatePlayerStates(_ context.Context, _ string, players []relay.PlayerSettlement) error {
	t.updated = append([]relay.PlayerSettlement(nil), players...)
	return nil
}

func (t *captureStageTx) MarkStageSettled(context.Context, string, string, time.Time) (bool, error) {
	t.marked = true
	return true, nil
}

func (t *captureStageTx) AppendStageStarted(context.Context, string, relay.StageStartedEvent) error {
	return nil
}

func (t *captureStageTx) AppendStageEnded(context.Context, string, relay.StageEndedEvent) error {
	t.endedEvents++
	return nil
}

func TestStageCoordinatorPassesUnifiedOutcomesToScoringPolicy(t *testing.T) {
	now := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)
	players := playerSnapshots(4)
	winner := players[1].MemberID
	plan := relay.StagePlan{
		StageID: "stage-1", Match: relay.MatchContext{MatchID: "match-1", RoomID: "room-1", MatchIndex: 0},
		StageIndex: 1, Status: relay.StageStatusPlanned, StartsAt: now,
		Encounters: []relay.EncounterPlan{
			{EncounterID: "encounter-1", EncounterIndex: 1, AnswerID: "answer-1", StartsAt: now, Deadline: now.Add(time.Minute), Members: [2]relay.PlayerSnapshot{players[0], players[1]}},
			{EncounterID: "encounter-2", EncounterIndex: 2, AnswerID: "answer-2", StartsAt: now, Deadline: now.Add(time.Minute), Members: [2]relay.PlayerSnapshot{players[2], players[3]}},
		},
	}
	states := make([]relay.PlayerState, 0, len(players))
	for _, player := range players {
		states = append(states, relay.PlayerState{Player: player, LifeState: relay.LifeStateHealthy, Status: "active"})
	}
	tx := &captureStageTx{
		stage: relay.StageRecord{StageID: plan.StageID, MatchID: plan.Match.MatchID, StageIndex: 1, Status: relay.StageStatusPlaying, PlannedEncounterCount: 2},
		plan:  plan, states: states,
		outcomes: []relay.EncounterOutcome{
			{EncounterID: "encounter-1", EncounterIndex: 1, Status: relay.EncounterStatusEnded, Members: plan.Encounters[0].Members, WinnerMemberID: &winner},
			{EncounterID: "encounter-2", EncounterIndex: 2, Status: relay.EncounterStatusEnded, Members: plan.Encounters[1].Members},
		},
	}
	scoring := &captureScoring{}
	coordinator, err := relay.NewStageCoordinator(
		unusedRepository{}, relay.RandomPairingPolicy{}, unusedProvisioner{}, scoring,
		fixedClock{now: now}, &sequenceRandom{values: []int{0}}, fixedIDs{value: "unused"}, 0,
	)
	if err != nil {
		t.Fatal(err)
	}
	result, err := coordinator.TrySettleInTransaction(context.Background(), tx, plan.StageID)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Ready || !result.Owner || scoring.calls != 1 || !tx.marked || tx.endedEvents != 1 {
		t.Fatalf("result=%+v scoring=%d marked=%t events=%d", result, scoring.calls, tx.marked, tx.endedEvents)
	}
	want := []relay.PlayerOutcome{relay.OutcomeLoss, relay.OutcomeWin, relay.OutcomeDraw, relay.OutcomeDraw}
	for index, participant := range scoring.input.Participants {
		if participant.Player.Seat != index+1 || participant.Outcome != want[index] {
			t.Fatalf("participant %d = %+v, want seat=%d outcome=%s", index, participant, index+1, want[index])
		}
	}
	if len(tx.inserted) != 4 || len(tx.updated) != 4 || tx.matchLocks != 1 {
		t.Fatalf("inserted=%d updated=%d matchLocks=%d", len(tx.inserted), len(tx.updated), tx.matchLocks)
	}
}

func TestStageCoordinatorDoesNotLockMatchBeforeBarrierIsReady(t *testing.T) {
	now := time.Now().UTC()
	players := playerSnapshots(2)
	plan := relay.StagePlan{
		StageID: "stage-1", Match: relay.MatchContext{MatchID: "match-1", RoomID: "room-1"}, StageIndex: 1,
		Status: relay.StageStatusPlanned, StartsAt: now,
		Encounters: []relay.EncounterPlan{{EncounterID: "encounter-1", EncounterIndex: 1, AnswerID: "answer", StartsAt: now, Deadline: now.Add(time.Minute), Members: [2]relay.PlayerSnapshot{players[0], players[1]}}},
	}
	tx := &captureStageTx{
		stage:    relay.StageRecord{StageID: plan.StageID, MatchID: plan.Match.MatchID, StageIndex: 1, Status: relay.StageStatusPlaying, PlannedEncounterCount: 1},
		plan:     plan,
		outcomes: []relay.EncounterOutcome{{EncounterID: "encounter-1", EncounterIndex: 1, Status: relay.EncounterStatusPlanned, Members: plan.Encounters[0].Members}},
	}
	scoring := &captureScoring{}
	coordinator, err := relay.NewStageCoordinator(
		unusedRepository{}, relay.RandomPairingPolicy{}, unusedProvisioner{}, scoring,
		core.SystemClock{}, &sequenceRandom{values: []int{0}}, fixedIDs{value: "unused"}, 0,
	)
	if err != nil {
		t.Fatal(err)
	}
	result, err := coordinator.TrySettleInTransaction(context.Background(), tx, plan.StageID)
	if err != nil {
		t.Fatal(err)
	}
	if result.Ready || scoring.calls != 0 || tx.matchLocks != 0 {
		t.Fatalf("result=%+v scoring=%d matchLocks=%d", result, scoring.calls, tx.matchLocks)
	}
}
