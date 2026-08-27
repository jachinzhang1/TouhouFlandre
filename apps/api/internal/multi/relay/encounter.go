package relay

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
)

const MaxSkipsPerPlayer = 2

var (
	ErrEncounterNotFound    = errors.New("relay: encounter not found")
	ErrNotEncounterPlayer   = errors.New("relay: actor is not an encounter player")
	ErrNotYourTurn          = errors.New("relay: actor does not own the current turn")
	ErrEncounterEnded       = errors.New("relay: encounter ended")
	ErrEncounterNotActive   = errors.New("relay: encounter not active")
	ErrTurnExpired          = errors.New("relay: encounter turn expired")
	ErrInvalidGuess         = errors.New("relay: invalid encounter guess")
	ErrDuplicateGuess       = errors.New("relay: duplicate encounter guess")
	ErrIdempotencyConflict  = errors.New("relay: idempotency conflict")
	ErrQuestionPoolTooSmall = errors.New("relay: question pool too small for pairings")
)

type TurnKind string

const (
	TurnKindGuess   TurnKind = "guess"
	TurnKindPass    TurnKind = "pass"
	TurnKindTimeout TurnKind = "timeout"
)

type Turn struct {
	ID             string
	Index          int
	MemberID       string
	Kind           TurnKind
	GuessID        string
	Statuses       []string
	Correct        bool
	IdempotencyKey string
}

type TerminalReason string

const (
	TerminalWin           TerminalReason = "win"
	TerminalLoss          TerminalReason = "loss"
	TerminalDraw          TerminalReason = "draw"
	TerminalForfeit       TerminalReason = "forfeit"
	TerminalTimeout       TerminalReason = "timeout"
	TerminalServerRestart TerminalReason = "server_restart"
)

type EncounterState struct {
	ID                string
	Status            EncounterStatus
	Members           [2]PlayerSnapshot
	TurnMemberID      string
	TurnDeadline      time.Time
	Deadline          time.Time
	MaxTurnsPerPlayer int
	Turns             []Turn
}

type Transition struct {
	Turn             *Turn
	Ended            bool
	Reason           TerminalReason
	WinnerMemberID   *string
	NextTurnMemberID *string
	NextTurnDeadline *time.Time
}

func FirstTurnPlayer(stageIndex int, members [2]PlayerSnapshot) (PlayerSnapshot, error) {
	if stageIndex < 1 || members[0].MemberID == "" || members[1].MemberID == "" || members[0].MemberID == members[1].MemberID {
		return PlayerSnapshot{}, fmt.Errorf("%w: invalid first-turn input", ErrInvalidStagePlan)
	}
	ordered := members
	if ordered[0].Seat > ordered[1].Seat {
		ordered[0], ordered[1] = ordered[1], ordered[0]
	}
	if stageIndex%2 == 0 {
		return ordered[1], nil
	}
	return ordered[0], nil
}

func ApplyTurn(state EncounterState, turn Turn, nextDeadline time.Time) (Transition, error) {
	if state.Status == EncounterStatusEnded {
		return Transition{}, ErrEncounterEnded
	}
	if !isMember(state.Members, turn.MemberID) {
		return Transition{}, ErrNotEncounterPlayer
	}
	if state.TurnMemberID != turn.MemberID {
		return Transition{}, ErrNotYourTurn
	}
	if state.MaxTurnsPerPlayer <= 0 || turn.Index != len(state.Turns)+1 {
		return Transition{}, fmt.Errorf("%w: invalid turn sequence", ErrInvalidStagePlan)
	}
	for _, existing := range state.Turns {
		if turn.Kind == TurnKindGuess && existing.Kind == TurnKindGuess && existing.GuessID == turn.GuessID {
			return Transition{}, ErrDuplicateGuess
		}
	}

	transition := Transition{Turn: &turn}
	if turn.Correct {
		winner := turn.MemberID
		transition.Ended, transition.Reason, transition.WinnerMemberID = true, TerminalWin, &winner
		return transition, nil
	}
	if turn.Kind == TurnKindPass || turn.Kind == TurnKindTimeout {
		skips := 0
		for _, existing := range state.Turns {
			if existing.MemberID == turn.MemberID && (existing.Kind == TurnKindPass || existing.Kind == TurnKindTimeout) {
				skips++
			}
		}
		if skips >= MaxSkipsPerPlayer {
			winner := otherMember(state.Members, turn.MemberID).MemberID
			transition.Ended, transition.Reason, transition.WinnerMemberID = true, TerminalLoss, &winner
			return transition, nil
		}
	}

	turns := append(append([]Turn(nil), state.Turns...), turn)
	counts := map[string]int{}
	for _, row := range turns {
		counts[row.MemberID]++
	}
	if counts[state.Members[0].MemberID] >= state.MaxTurnsPerPlayer && counts[state.Members[1].MemberID] >= state.MaxTurnsPerPlayer {
		transition.Ended, transition.Reason = true, TerminalDraw
		return transition, nil
	}
	next := otherMember(state.Members, turn.MemberID)
	if counts[next.MemberID] >= state.MaxTurnsPerPlayer {
		next = memberByID(state.Members, turn.MemberID)
	}
	transition.NextTurnMemberID = &next.MemberID
	transition.NextTurnDeadline = &nextDeadline
	return transition, nil
}

func Forfeit(state EncounterState, actorID string) (Transition, error) {
	if state.Status == EncounterStatusEnded {
		return Transition{}, ErrEncounterEnded
	}
	if !isMember(state.Members, actorID) {
		return Transition{}, ErrNotEncounterPlayer
	}
	if state.TurnMemberID != actorID {
		return Transition{}, ErrNotYourTurn
	}
	return ForfeitAssigned(state, actorID)
}

// ForfeitAssigned preserves the legacy two-player round endpoint, where
// either assigned player may concede regardless of the current turn.
func ForfeitAssigned(state EncounterState, actorID string) (Transition, error) {
	if state.Status == EncounterStatusEnded {
		return Transition{}, ErrEncounterEnded
	}
	if !isMember(state.Members, actorID) {
		return Transition{}, ErrNotEncounterPlayer
	}
	winner := otherMember(state.Members, actorID).MemberID
	return Transition{Ended: true, Reason: TerminalForfeit, WinnerMemberID: &winner}, nil
}

func DeadlineTransition() Transition {
	return Transition{Ended: true, Reason: TerminalTimeout}
}

type QuestionProvisioner struct {
	Random core.RandomSource
}

func (p QuestionProvisioner) Provision(_ context.Context, input StageProvisionInput) ([]EncounterSeed, error) {
	if p.Random == nil || input.TurnSeconds <= 0 || input.EncounterDuration <= 0 {
		return nil, fmt.Errorf("%w: provisioner dependencies are incomplete", ErrInvalidStagePlan)
	}
	count := len(input.Pairing.Pairs)
	pool := uniqueStrings(input.CandidateAnswerIDs)
	if len(pool) < count {
		return nil, ErrQuestionPoolTooSmall
	}
	used := make(map[string]struct{}, len(input.UsedAnswerIDs))
	for _, id := range input.UsedAnswerIDs {
		used[id] = struct{}{}
	}
	candidates := make([]string, 0, len(pool))
	for _, id := range pool {
		if _, exists := used[id]; !exists {
			candidates = append(candidates, id)
		}
	}
	if len(candidates) < count {
		return nil, ErrQuestionPoolTooSmall
	}
	for index := 0; index < count; index++ {
		draw := index + p.Random.IntN(len(candidates)-index)
		if draw < index || draw >= len(candidates) {
			return nil, fmt.Errorf("%w: random source returned invalid question index", ErrInvalidStagePlan)
		}
		candidates[index], candidates[draw] = candidates[draw], candidates[index]
	}
	seeds := make([]EncounterSeed, 0, count)
	for index, pair := range input.Pairing.Pairs {
		first, err := FirstTurnPlayer(input.StageIndex, pair.Members)
		if err != nil {
			return nil, err
		}
		deadline := input.StartsAt.Add(input.EncounterDuration)
		turnDeadline := input.StartsAt.Add(time.Duration(input.TurnSeconds) * time.Second)
		if turnDeadline.After(deadline) {
			turnDeadline = deadline
		}
		seeds = append(seeds, EncounterSeed{
			EncounterIndex: pair.EncounterIndex,
			AnswerID:       candidates[index],
			Deadline:       deadline,
			TurnMemberID:   first.MemberID,
			TurnDeadline:   turnDeadline,
		})
	}
	return seeds, nil
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func isMember(members [2]PlayerSnapshot, memberID string) bool {
	return members[0].MemberID == memberID || members[1].MemberID == memberID
}

func memberByID(members [2]PlayerSnapshot, memberID string) PlayerSnapshot {
	if members[0].MemberID == memberID {
		return members[0]
	}
	return members[1]
}

func otherMember(members [2]PlayerSnapshot, memberID string) PlayerSnapshot {
	if members[0].MemberID == memberID {
		return members[1]
	}
	return members[0]
}
