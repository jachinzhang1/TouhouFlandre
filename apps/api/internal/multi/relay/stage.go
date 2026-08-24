package relay

import (
	"context"
	"fmt"
	"time"
)

const SettlementMarkerVersion = 1

type StageStatus string

const (
	StageStatusPlanned  StageStatus = "planned"
	StageStatusPlaying  StageStatus = "playing"
	StageStatusSettling StageStatus = "settling"
	StageStatusEnded    StageStatus = "ended"
)

type EncounterStatus string

const (
	EncounterStatusPlanned EncounterStatus = "planned"
	EncounterStatusEnded   EncounterStatus = "ended"
)

type Assignment string

const (
	AssignmentPaired Assignment = "paired"
	AssignmentBye    Assignment = "bye"
)

type PlayerOutcome string

const (
	OutcomeWin  PlayerOutcome = "win"
	OutcomeLoss PlayerOutcome = "loss"
	OutcomeDraw PlayerOutcome = "draw"
	OutcomeBye  PlayerOutcome = "bye"
)

type LifeState string

const (
	LifeStateHealthy   LifeState = "healthy"
	LifeStateNearDeath LifeState = "near_death"
)

type MatchContext struct {
	MatchID    string
	RoomID     string
	MatchIndex int
}

type EncounterSeed struct {
	EncounterIndex int
	AnswerID       string
	Deadline       time.Time
}

type EncounterPlan struct {
	EncounterID    string
	EncounterIndex int
	AnswerID       string
	StartsAt       time.Time
	Deadline       time.Time
	Members        [2]PlayerSnapshot
}

type StagePlan struct {
	StageID    string
	Match      MatchContext
	StageIndex int
	Status     StageStatus
	StartsAt   time.Time
	Encounters []EncounterPlan
	Bye        *PlayerSnapshot
}

func (p StagePlan) Validate() error {
	if p.StageID == "" || p.Match.MatchID == "" || p.Match.RoomID == "" || p.Match.MatchIndex < 0 {
		return fmt.Errorf("%w: missing stage or match identity", ErrInvalidStagePlan)
	}
	if p.StageIndex < 1 || p.StartsAt.IsZero() || p.Status != StageStatusPlanned {
		return fmt.Errorf("%w: invalid stage metadata", ErrInvalidStagePlan)
	}
	pairing := PairingPlan{Pairs: make([]Pair, 0, len(p.Encounters)), Bye: p.Bye}
	encounterIDs := make(map[string]struct{}, len(p.Encounters))
	for index, encounter := range p.Encounters {
		if encounter.EncounterID == "" || encounter.EncounterIndex != index+1 || encounter.AnswerID == "" {
			return fmt.Errorf("%w: invalid encounter identity", ErrInvalidStagePlan)
		}
		if !encounter.StartsAt.Equal(p.StartsAt) || !encounter.Deadline.After(encounter.StartsAt) {
			return fmt.Errorf("%w: encounters must share startsAt and have a later deadline", ErrInvalidStagePlan)
		}
		if _, exists := encounterIDs[encounter.EncounterID]; exists {
			return fmt.Errorf("%w: duplicate encounter id", ErrInvalidStagePlan)
		}
		encounterIDs[encounter.EncounterID] = struct{}{}
		pairing.Pairs = append(pairing.Pairs, Pair{EncounterIndex: encounter.EncounterIndex, Members: encounter.Members})
	}
	return pairing.Validate()
}

type StageProvisionInput struct {
	Match      MatchContext
	StageIndex int
	StartsAt   time.Time
	Pairing    PairingPlan
}

// EncounterProvisioner is the relay-owned extension point that MRX-006 will
// use to attach answers and deadlines. MRX-005 only validates and persists it.
type EncounterProvisioner interface {
	Provision(context.Context, StageProvisionInput) ([]EncounterSeed, error)
}

type IDSource interface {
	NewID() string
}

type IDSourceFunc func() string

func (f IDSourceFunc) NewID() string { return f() }

type EncounterOutcome struct {
	EncounterID    string
	EncounterIndex int
	Status         EncounterStatus
	Members        [2]PlayerSnapshot
	WinnerMemberID *string
}

type ParticipantOutcome struct {
	Player      PlayerSnapshot
	EncounterID *string
	Assignment  Assignment
	Outcome     PlayerOutcome
}

type PlayerState struct {
	Player          PlayerSnapshot
	Score           int
	LifeState       LifeState
	Status          string
	EliminatedStage *int
}

type SettlementInput struct {
	Match        MatchContext
	StageID      string
	StageIndex   int
	Participants []ParticipantOutcome
	States       []PlayerState
}

type PlayerSettlement struct {
	Player          PlayerSnapshot
	EncounterID     *string
	Assignment      Assignment
	Outcome         PlayerOutcome
	ScoreBefore     int
	ScoreDelta      int
	ScoreAfter      int
	LifeBefore      LifeState
	LifeAfter       LifeState
	EliminatedStage *int
}

type SettlementDecision struct {
	Players         []PlayerSettlement
	Standings       []PlayerState
	CreateNextStage bool
	NextPlayers     []PlayerSnapshot
}

type ScoringPolicy interface {
	Settle(SettlementInput) (SettlementDecision, error)
}

type StageRecord struct {
	StageID               string
	MatchID               string
	StageIndex            int
	Status                StageStatus
	PlannedEncounterCount int
	StartsAt              time.Time
	SettledAt             *time.Time
	SettlementMarker      *string
}

type StageStartedEvent struct {
	MatchIndex  int
	StageID     string
	StageIndex  int
	Status      StageStatus
	Encounters  []EncounterPlan
	ByeMemberID *string
}

type StageEndedEvent struct {
	MatchIndex     int
	StageID        string
	StageIndex     int
	Settlement     []PlayerSettlement
	Standings      []PlayerState
	NextStageIndex *int
	ByeMemberID    *string
}

type StageTransaction interface {
	FindStage(context.Context, string, int, bool) (StageRecord, bool, error)
	GetStage(context.Context, string, bool) (StageRecord, bool, error)
	LoadStagePlan(context.Context, string) (StagePlan, error)
	CreateStage(context.Context, StagePlan) error
	LockMatch(context.Context, string) (MatchContext, error)
	ListEncounterOutcomes(context.Context, string) ([]EncounterOutcome, error)
	ListPlayerStates(context.Context, string) ([]PlayerState, error)
	InsertSettlement(context.Context, string, string, []PlayerSettlement, time.Time) error
	UpdatePlayerStates(context.Context, string, []PlayerSettlement) error
	MarkStageSettled(context.Context, string, string, time.Time) (bool, error)
	AppendStageStarted(context.Context, string, StageStartedEvent) error
	AppendStageEnded(context.Context, string, StageEndedEvent) error
}

type StageRepository interface {
	Transact(context.Context, func(StageTransaction) error) error
	ListSettlementCandidates(context.Context, int) ([]string, error)
}

type CreateStageRequest struct {
	Match               MatchContext
	StageIndex          int
	ActivePlayers       []PlayerSnapshot
	PreviousByeMemberID *string
	StartsAt            time.Time
}

type CreateStageResult struct {
	Plan    StagePlan
	Created bool
}

type SettlementResult struct {
	StageID        string
	Ready          bool
	Owner          bool
	AlreadySettled bool
	NextStage      *StagePlan
}
