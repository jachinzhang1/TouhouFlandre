package relay

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
)

type StageCoordinator struct {
	repository   StageRepository
	pairing      PairingPolicy
	provisioner  EncounterProvisioner
	scoring      ScoringPolicy
	clock        core.Clock
	random       core.RandomSource
	ids          IDSource
	intermission time.Duration
}

func NewStageCoordinator(
	repository StageRepository,
	pairing PairingPolicy,
	provisioner EncounterProvisioner,
	scoring ScoringPolicy,
	clock core.Clock,
	random core.RandomSource,
	ids IDSource,
	intermission time.Duration,
) (*StageCoordinator, error) {
	if repository == nil || pairing == nil || provisioner == nil || scoring == nil || clock == nil || random == nil || ids == nil {
		return nil, fmt.Errorf("%w: coordinator dependencies are required", ErrInvalidStagePlan)
	}
	if intermission < 0 {
		return nil, fmt.Errorf("%w: intermission cannot be negative", ErrInvalidStagePlan)
	}
	return &StageCoordinator{
		repository: repository, pairing: pairing, provisioner: provisioner, scoring: scoring,
		clock: clock, random: random, ids: ids, intermission: intermission,
	}, nil
}

func (c *StageCoordinator) CreateStage(ctx context.Context, request CreateStageRequest) (CreateStageResult, error) {
	var result CreateStageResult
	err := c.repository.Transact(ctx, func(tx StageTransaction) error {
		var err error
		result, err = c.CreateStageInTransaction(ctx, tx, request)
		return err
	})
	return result, err
}

// CreateStageInTransaction lets match creation persist the first relay stage
// atomically with the frozen roster and match record.
func (c *StageCoordinator) CreateStageInTransaction(ctx context.Context, tx StageTransaction, request CreateStageRequest) (CreateStageResult, error) {
	current, exists, err := tx.FindStage(ctx, request.Match.MatchID, request.StageIndex, true)
	if err != nil {
		return CreateStageResult{}, err
	}
	if exists {
		match, err := tx.LockMatch(ctx, current.MatchID)
		if err != nil {
			return CreateStageResult{}, err
		}
		if err := validateMatchContext(request.Match, match); err != nil {
			return CreateStageResult{}, err
		}
		plan, err := tx.LoadStagePlan(ctx, current.StageID)
		if err != nil {
			return CreateStageResult{}, err
		}
		return CreateStageResult{Plan: plan, Created: false}, nil
	}
	if request.StageIndex > 1 {
		previous, found, err := tx.FindStage(ctx, request.Match.MatchID, request.StageIndex-1, true)
		if err != nil {
			return CreateStageResult{}, err
		}
		if !found || previous.Status != StageStatusEnded || previous.SettlementMarker == nil {
			return CreateStageResult{}, fmt.Errorf("%w: previous stage is not settled", ErrInvalidStagePlan)
		}
	}
	match, err := tx.LockMatch(ctx, request.Match.MatchID)
	if err != nil {
		return CreateStageResult{}, err
	}
	if err := validateMatchContext(request.Match, match); err != nil {
		return CreateStageResult{}, err
	}
	request.Match = match

	plan, err := c.buildStagePlan(ctx, request)
	if err != nil {
		return CreateStageResult{}, err
	}
	if err := tx.CreateStage(ctx, plan); err != nil {
		return CreateStageResult{}, err
	}
	if err := tx.AppendStageStarted(ctx, plan.Match.RoomID, startedEvent(plan)); err != nil {
		return CreateStageResult{}, err
	}
	return CreateStageResult{Plan: plan, Created: true}, nil
}

func (c *StageCoordinator) TrySettle(ctx context.Context, stageID string) (SettlementResult, error) {
	var result SettlementResult
	err := c.repository.Transact(ctx, func(tx StageTransaction) error {
		var err error
		result, err = c.TrySettleInTransaction(ctx, tx, stageID)
		return err
	})
	return result, err
}

// TrySettleInTransaction is called after an encounter engine has locked and
// ended only its own encounter. It never locks sibling encounter rows.
func (c *StageCoordinator) TrySettleInTransaction(ctx context.Context, tx StageTransaction, stageID string) (SettlementResult, error) {
	return c.trySettleInTransaction(ctx, tx, stageID, nil)
}

// TrySettleForMatchEndInTransaction is the narrow N=2 compatibility path for
// a permanent leave or disconnect. Ordinary encounter forfeits use the normal
// stage policy and do not terminate the match.
func (c *StageCoordinator) TrySettleForMatchEndInTransaction(ctx context.Context, tx StageTransaction, stageID string, forced ForcedMatchEnd) (SettlementResult, error) {
	if forced.Reason == "" {
		return SettlementResult{}, fmt.Errorf("%w: forced match end is incomplete", ErrInvalidStagePlan)
	}
	return c.trySettleInTransaction(ctx, tx, stageID, &forced)
}

func (c *StageCoordinator) trySettleInTransaction(ctx context.Context, tx StageTransaction, stageID string, forced *ForcedMatchEnd) (SettlementResult, error) {
	stage, found, err := tx.GetStage(ctx, stageID, true)
	if err != nil {
		return SettlementResult{}, err
	}
	if !found {
		return SettlementResult{}, fmt.Errorf("%w: stage %s does not exist", ErrInvalidStagePlan, stageID)
	}
	if stage.Status == StageStatusEnded && stage.SettlementMarker != nil {
		if _, err := tx.LockMatch(ctx, stage.MatchID); err != nil {
			return SettlementResult{}, err
		}
		result := SettlementResult{StageID: stageID, Ready: true, AlreadySettled: true}
		if next, exists, err := tx.FindStage(ctx, stage.MatchID, stage.StageIndex+1, false); err != nil {
			return SettlementResult{}, err
		} else if exists {
			plan, err := tx.LoadStagePlan(ctx, next.StageID)
			if err != nil {
				return SettlementResult{}, err
			}
			result.NextStage = &plan
		}
		return result, nil
	}

	encounters, err := tx.ListEncounterOutcomes(ctx, stageID)
	if err != nil {
		return SettlementResult{}, err
	}
	if len(encounters) != stage.PlannedEncounterCount {
		return SettlementResult{}, fmt.Errorf("%w: persisted encounter count does not match stage plan", ErrInvalidStagePlan)
	}
	for _, encounter := range encounters {
		if encounter.Status != EncounterStatusEnded {
			return SettlementResult{StageID: stageID}, nil
		}
	}

	match, err := tx.LockMatch(ctx, stage.MatchID)
	if err != nil {
		return SettlementResult{}, err
	}
	plan, err := tx.LoadStagePlan(ctx, stageID)
	if err != nil {
		return SettlementResult{}, err
	}
	participants, err := participantOutcomes(plan, encounters)
	if err != nil {
		return SettlementResult{}, err
	}
	states, err := tx.ListPlayerStates(ctx, stage.MatchID)
	if err != nil {
		return SettlementResult{}, err
	}
	decision, err := c.scoring.Settle(SettlementInput{
		Match: match, StageID: stageID, StageIndex: stage.StageIndex,
		Participants: participants, States: states, ForcedMatchEnd: forced,
	})
	if err != nil {
		return SettlementResult{}, err
	}
	if err := validateSettlementDecision(participants, states, decision); err != nil {
		return SettlementResult{}, err
	}

	now := c.clock.Now()
	var nextPlan *StagePlan
	if decision.CreateNextStage {
		var previousBye *string
		if plan.Bye != nil {
			previousBye = &plan.Bye.MemberID
		}
		built, err := c.buildStagePlan(ctx, CreateStageRequest{
			Match: match, StageIndex: stage.StageIndex + 1, ActivePlayers: decision.NextPlayers,
			PreviousByeMemberID: previousBye, StartsAt: now.Add(c.intermission),
		})
		if err != nil {
			return SettlementResult{}, err
		}
		nextPlan = &built
	}

	if err := tx.InsertSettlement(ctx, stage.MatchID, stageID, decision.Players, now); err != nil {
		return SettlementResult{}, err
	}
	if err := tx.UpdatePlayerStates(ctx, stage.MatchID, decision.Players); err != nil {
		return SettlementResult{}, err
	}
	if decision.Match != nil {
		applier, ok := tx.(MatchDecisionTransaction)
		if !ok {
			return SettlementResult{}, fmt.Errorf("%w: repository cannot apply match decision", ErrInvalidStagePlan)
		}
		if err := applier.ApplyMatchDecision(ctx, match, *decision.Match, now); err != nil {
			return SettlementResult{}, err
		}
	}
	marker := settlementMarker(stageID)
	owned, err := tx.MarkStageSettled(ctx, stageID, marker, now)
	if err != nil {
		return SettlementResult{}, err
	}
	if !owned {
		return SettlementResult{}, fmt.Errorf("%w: settlement ownership was lost", ErrInvalidStagePlan)
	}

	ended := StageEndedEvent{
		MatchIndex: match.MatchIndex, StageID: stageID, StageIndex: stage.StageIndex,
		Settlement: decision.Players, Standings: decision.Standings,
		EliminatedMemberIDs: decision.EliminatedMemberIDs,
	}
	if plan.Bye != nil {
		ended.ByeMemberID = &plan.Bye.MemberID
	}
	if nextPlan != nil {
		nextIndex := nextPlan.StageIndex
		ended.NextStageIndex = &nextIndex
	}
	if err := tx.AppendStageEnded(ctx, match.RoomID, ended); err != nil {
		return SettlementResult{}, err
	}
	if nextPlan != nil {
		if err := tx.CreateStage(ctx, *nextPlan); err != nil {
			return SettlementResult{}, err
		}
		if err := tx.AppendStageStarted(ctx, match.RoomID, startedEvent(*nextPlan)); err != nil {
			return SettlementResult{}, err
		}
	}
	return SettlementResult{StageID: stageID, Ready: true, Owner: true, NextStage: nextPlan}, nil
}

func (c *StageCoordinator) RecoverSettlements(ctx context.Context, limit int) ([]SettlementResult, error) {
	stageIDs, err := c.repository.ListSettlementCandidates(ctx, limit)
	if err != nil {
		return nil, err
	}
	results := make([]SettlementResult, 0, len(stageIDs))
	for _, stageID := range stageIDs {
		result, err := c.TrySettle(ctx, stageID)
		if err != nil {
			return results, err
		}
		results = append(results, result)
	}
	return results, nil
}

func (c *StageCoordinator) buildStagePlan(ctx context.Context, request CreateStageRequest) (StagePlan, error) {
	pairing, err := c.pairing.Plan(request.ActivePlayers, request.PreviousByeMemberID, c.random)
	if err != nil {
		return StagePlan{}, err
	}
	seeds, err := c.provisioner.Provision(ctx, StageProvisionInput{
		Match: request.Match, StageIndex: request.StageIndex, StartsAt: request.StartsAt, Pairing: pairing,
		CandidateAnswerIDs: request.CandidateAnswerIDs, UsedAnswerIDs: request.UsedAnswerIDs,
		TurnSeconds: request.TurnSeconds, EncounterDuration: request.EncounterDuration,
	})
	if err != nil {
		return StagePlan{}, err
	}
	if len(seeds) != len(pairing.Pairs) {
		return StagePlan{}, fmt.Errorf("%w: provisioner returned the wrong encounter count", ErrInvalidStagePlan)
	}
	byIndex := make(map[int]EncounterSeed, len(seeds))
	for _, seed := range seeds {
		if seed.EncounterIndex < 1 || seed.EncounterIndex > len(pairing.Pairs) {
			return StagePlan{}, fmt.Errorf("%w: provisioner returned an invalid encounter index", ErrInvalidStagePlan)
		}
		if _, exists := byIndex[seed.EncounterIndex]; exists {
			return StagePlan{}, fmt.Errorf("%w: provisioner returned a duplicate encounter index", ErrInvalidStagePlan)
		}
		byIndex[seed.EncounterIndex] = seed
	}
	plan := StagePlan{
		StageID: c.ids.NewID(), Match: request.Match, StageIndex: request.StageIndex,
		Status: StageStatusPlanned, StartsAt: request.StartsAt, Bye: pairing.Bye,
		Encounters: make([]EncounterPlan, 0, len(pairing.Pairs)),
	}
	for _, pair := range pairing.Pairs {
		seed := byIndex[pair.EncounterIndex]
		plan.Encounters = append(plan.Encounters, EncounterPlan{
			EncounterID: c.ids.NewID(), EncounterIndex: pair.EncounterIndex, AnswerID: seed.AnswerID,
			StartsAt: request.StartsAt, Deadline: seed.Deadline, TurnMemberID: seed.TurnMemberID,
			TurnDeadline: seed.TurnDeadline, Members: pair.Members,
		})
	}
	if err := plan.Validate(); err != nil {
		return StagePlan{}, err
	}
	return plan, nil
}

func participantOutcomes(plan StagePlan, outcomes []EncounterOutcome) ([]ParticipantOutcome, error) {
	byID := make(map[string]EncounterOutcome, len(outcomes))
	for _, outcome := range outcomes {
		byID[outcome.EncounterID] = outcome
	}
	participants := make([]ParticipantOutcome, 0, len(plan.Encounters)*2+1)
	for _, encounter := range plan.Encounters {
		outcome, exists := byID[encounter.EncounterID]
		if !exists || outcome.EncounterIndex != encounter.EncounterIndex || outcome.Members != encounter.Members {
			return nil, fmt.Errorf("%w: encounter outcome does not match the frozen plan", ErrInvalidStagePlan)
		}
		first, second := OutcomeDraw, OutcomeDraw
		if outcome.WinnerMemberID != nil {
			switch *outcome.WinnerMemberID {
			case encounter.Members[0].MemberID:
				first, second = OutcomeWin, OutcomeLoss
			case encounter.Members[1].MemberID:
				first, second = OutcomeLoss, OutcomeWin
			default:
				return nil, fmt.Errorf("%w: encounter winner is not a participant", ErrInvalidStagePlan)
			}
		}
		encounterID := encounter.EncounterID
		participants = append(participants,
			ParticipantOutcome{Player: encounter.Members[0], EncounterID: &encounterID, Assignment: AssignmentPaired, Outcome: first},
			ParticipantOutcome{Player: encounter.Members[1], EncounterID: &encounterID, Assignment: AssignmentPaired, Outcome: second},
		)
	}
	if plan.Bye != nil {
		participants = append(participants, ParticipantOutcome{Player: *plan.Bye, Assignment: AssignmentBye, Outcome: OutcomeBye})
	}
	sort.Slice(participants, func(i, j int) bool { return participants[i].Player.Seat < participants[j].Player.Seat })
	return participants, nil
}

func validateSettlementDecision(participants []ParticipantOutcome, states []PlayerState, decision SettlementDecision) error {
	if len(decision.Players) != len(participants) || len(decision.Standings) != len(states) {
		return fmt.Errorf("%w: scoring policy did not cover every player", ErrInvalidStagePlan)
	}
	participantByID := make(map[string]ParticipantOutcome, len(participants))
	stateByID := make(map[string]PlayerState, len(states))
	for _, participant := range participants {
		participantByID[participant.Player.MemberID] = participant
	}
	for _, state := range states {
		if _, exists := stateByID[state.Player.MemberID]; exists {
			return fmt.Errorf("%w: duplicate persisted player state", ErrInvalidStagePlan)
		}
		stateByID[state.Player.MemberID] = state
	}
	seen := make(map[string]struct{}, len(decision.Players))
	eliminated := make(map[string]struct{}, len(decision.EliminatedMemberIDs))
	for _, memberID := range decision.EliminatedMemberIDs {
		if memberID == "" {
			return fmt.Errorf("%w: eliminated member id is empty", ErrInvalidStagePlan)
		}
		if _, duplicate := eliminated[memberID]; duplicate {
			return fmt.Errorf("%w: duplicate eliminated member id", ErrInvalidStagePlan)
		}
		eliminated[memberID] = struct{}{}
	}
	standingByID := make(map[string]PlayerState, len(decision.Standings))
	for _, standing := range decision.Standings {
		standingByID[standing.Player.MemberID] = standing
	}
	for _, settlement := range decision.Players {
		participant, ok := participantByID[settlement.Player.MemberID]
		state, stateOK := stateByID[settlement.Player.MemberID]
		if !ok || !stateOK || settlement.Player != participant.Player || settlement.Assignment != participant.Assignment || settlement.Outcome != participant.Outcome {
			return fmt.Errorf("%w: scoring policy changed a frozen participant outcome", ErrInvalidStagePlan)
		}
		if !sameOptionalString(settlement.EncounterID, participant.EncounterID) || settlement.ScoreBefore != state.Score || settlement.LifeBefore != state.LifeState {
			return fmt.Errorf("%w: scoring policy used stale player state", ErrInvalidStagePlan)
		}
		if settlement.ScoreAfter != settlement.ScoreBefore+settlement.ScoreDelta {
			return fmt.Errorf("%w: inconsistent score delta", ErrInvalidStagePlan)
		}
		standing, ok := standingByID[settlement.Player.MemberID]
		if !ok || standing.Score != settlement.ScoreAfter || standing.LifeState != settlement.LifeAfter ||
			!sameOptionalInt(standing.EliminatedStage, settlement.EliminatedStage) {
			return fmt.Errorf("%w: settlement does not match resulting standing", ErrInvalidStagePlan)
		}
		switch settlement.LifeTransition {
		case LifeTransitionNone:
			if settlement.LifeBefore != settlement.LifeAfter || !sameOptionalInt(settlement.EliminatedStage, state.EliminatedStage) {
				return fmt.Errorf("%w: invalid unchanged life transition", ErrInvalidStagePlan)
			}
		case LifeTransitionEnteredNearDeath:
			if settlement.LifeBefore != LifeStateHealthy || settlement.LifeAfter != LifeStateNearDeath ||
				settlement.ScoreAfter != 0 || settlement.EliminatedStage != nil {
				return fmt.Errorf("%w: invalid near-death transition", ErrInvalidStagePlan)
			}
		case LifeTransitionEliminated:
			if settlement.LifeBefore != LifeStateNearDeath || settlement.LifeAfter != LifeStateNearDeath ||
				settlement.ScoreAfter >= 0 || settlement.EliminatedStage == nil || standing.Status != "eliminated" {
				return fmt.Errorf("%w: invalid elimination transition", ErrInvalidStagePlan)
			}
			if _, ok := eliminated[settlement.Player.MemberID]; !ok {
				return fmt.Errorf("%w: elimination transition is absent from eliminated ids", ErrInvalidStagePlan)
			}
		default:
			return fmt.Errorf("%w: unknown life transition", ErrInvalidStagePlan)
		}
		if _, duplicate := seen[settlement.Player.MemberID]; duplicate {
			return fmt.Errorf("%w: duplicate settlement player", ErrInvalidStagePlan)
		}
		seen[settlement.Player.MemberID] = struct{}{}
	}
	for memberID := range eliminated {
		found := false
		for _, settlement := range decision.Players {
			if settlement.Player.MemberID == memberID && settlement.LifeTransition == LifeTransitionEliminated {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("%w: eliminated id has no elimination transition", ErrInvalidStagePlan)
		}
	}
	standingSeen := make(map[string]struct{}, len(decision.Standings))
	for _, standing := range decision.Standings {
		if _, ok := stateByID[standing.Player.MemberID]; !ok {
			return fmt.Errorf("%w: standing contains an unknown player", ErrInvalidStagePlan)
		}
		if _, duplicate := standingSeen[standing.Player.MemberID]; duplicate {
			return fmt.Errorf("%w: duplicate standing player", ErrInvalidStagePlan)
		}
		standingSeen[standing.Player.MemberID] = struct{}{}
	}
	if decision.CreateNextStage {
		if err := validateStableRoster(decision.NextPlayers); err != nil {
			return err
		}
	} else if len(decision.NextPlayers) != 0 {
		return fmt.Errorf("%w: next players require CreateNextStage", ErrInvalidStagePlan)
	}
	return nil
}

func sameOptionalString(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func sameOptionalInt(left, right *int) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func validateMatchContext(requested, persisted MatchContext) error {
	if requested.MatchID != persisted.MatchID || requested.RoomID != persisted.RoomID || requested.MatchIndex != persisted.MatchIndex {
		return fmt.Errorf("%w: match context does not match persisted identity", ErrInvalidStagePlan)
	}
	return nil
}

func startedEvent(plan StagePlan) StageStartedEvent {
	event := StageStartedEvent{
		MatchIndex: plan.Match.MatchIndex, StageID: plan.StageID, StageIndex: plan.StageIndex,
		StartsAt: plan.StartsAt, Status: plan.Status, Encounters: plan.Encounters,
	}
	if plan.Bye != nil {
		event.ByeMemberID = &plan.Bye.MemberID
	}
	return event
}

func settlementMarker(stageID string) string {
	return fmt.Sprintf("relay-stage-settlement/v%d:%s", SettlementMarkerVersion, stageID)
}
