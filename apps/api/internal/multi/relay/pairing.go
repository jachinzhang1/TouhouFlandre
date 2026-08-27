package relay

import (
	"errors"
	"fmt"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
)

var ErrInvalidStagePlan = errors.New("relay: invalid stage plan")

type PlayerSnapshot struct {
	MemberID string `json:"memberId"`
	Seat     int    `json:"seat"`
}

type Pair struct {
	EncounterIndex int               `json:"encounterIndex"`
	Members        [2]PlayerSnapshot `json:"members"`
}

type PairingPlan struct {
	Pairs []Pair          `json:"pairs"`
	Bye   *PlayerSnapshot `json:"bye,omitempty"`
}

type PairingPolicy interface {
	Plan(active []PlayerSnapshot, previousByeMemberID *string, random core.RandomSource) (PairingPlan, error)
}

type RandomPairingPolicy struct{}

func (RandomPairingPolicy) Plan(active []PlayerSnapshot, previousByeMemberID *string, random core.RandomSource) (PairingPlan, error) {
	if random == nil {
		return PairingPlan{}, fmt.Errorf("%w: random source is required", ErrInvalidStagePlan)
	}
	if err := validateStableRoster(active); err != nil {
		return PairingPlan{}, err
	}

	players := append([]PlayerSnapshot(nil), active...)
	var bye *PlayerSnapshot
	if len(players)%2 == 1 {
		candidates := make([]int, 0, len(players))
		for index, player := range players {
			if previousByeMemberID == nil || player.MemberID != *previousByeMemberID {
				candidates = append(candidates, index)
			}
		}
		if len(candidates) == 0 {
			return PairingPlan{}, fmt.Errorf("%w: no eligible bye player", ErrInvalidStagePlan)
		}
		draw, err := drawIndex(random, len(candidates))
		if err != nil {
			return PairingPlan{}, err
		}
		byeIndex := candidates[draw]
		selected := players[byeIndex]
		bye = &selected
		players = append(players[:byeIndex], players[byeIndex+1:]...)
	}

	for index := len(players) - 1; index > 0; index-- {
		draw, err := drawIndex(random, index+1)
		if err != nil {
			return PairingPlan{}, err
		}
		players[index], players[draw] = players[draw], players[index]
	}

	plan := PairingPlan{Pairs: make([]Pair, 0, len(players)/2), Bye: bye}
	for index := 0; index < len(players); index += 2 {
		plan.Pairs = append(plan.Pairs, Pair{
			EncounterIndex: index/2 + 1,
			Members:        [2]PlayerSnapshot{players[index], players[index+1]},
		})
	}
	if err := plan.Validate(); err != nil {
		return PairingPlan{}, err
	}
	return plan, nil
}

func (p PairingPlan) Validate() error {
	participantCount := len(p.Pairs) * 2
	if p.Bye != nil {
		participantCount++
	}
	if participantCount < 2 || participantCount > 8 {
		return fmt.Errorf("%w: participant count must be between 2 and 8", ErrInvalidStagePlan)
	}
	if (participantCount%2 == 1) != (p.Bye != nil) {
		return fmt.Errorf("%w: odd participant count must have exactly one bye", ErrInvalidStagePlan)
	}
	if len(p.Pairs) < 1 || len(p.Pairs) > 4 {
		return fmt.Errorf("%w: encounter count must be between 1 and 4", ErrInvalidStagePlan)
	}

	members := make(map[string]struct{}, participantCount)
	seats := make(map[int]struct{}, participantCount)
	add := func(player PlayerSnapshot) error {
		if player.MemberID == "" || player.Seat < 1 || player.Seat > 8 {
			return fmt.Errorf("%w: invalid player snapshot", ErrInvalidStagePlan)
		}
		if _, exists := members[player.MemberID]; exists {
			return fmt.Errorf("%w: duplicate member %s", ErrInvalidStagePlan, player.MemberID)
		}
		if _, exists := seats[player.Seat]; exists {
			return fmt.Errorf("%w: duplicate seat %d", ErrInvalidStagePlan, player.Seat)
		}
		members[player.MemberID] = struct{}{}
		seats[player.Seat] = struct{}{}
		return nil
	}
	for index, pair := range p.Pairs {
		if pair.EncounterIndex != index+1 {
			return fmt.Errorf("%w: encounter indexes must be contiguous", ErrInvalidStagePlan)
		}
		for _, player := range pair.Members {
			if err := add(player); err != nil {
				return err
			}
		}
	}
	if p.Bye != nil {
		if err := add(*p.Bye); err != nil {
			return err
		}
	}
	return nil
}

func validateStableRoster(active []PlayerSnapshot) error {
	if len(active) < 2 || len(active) > 8 {
		return fmt.Errorf("%w: active roster size must be between 2 and 8", ErrInvalidStagePlan)
	}
	for index, player := range active {
		if player.MemberID == "" || player.Seat < 1 || player.Seat > 8 {
			return fmt.Errorf("%w: invalid player snapshot", ErrInvalidStagePlan)
		}
		if index > 0 && active[index-1].Seat >= player.Seat {
			return fmt.Errorf("%w: active roster must be sorted by unique seat", ErrInvalidStagePlan)
		}
	}
	return nil
}

func drawIndex(random core.RandomSource, size int) (int, error) {
	value := random.IntN(size)
	if value < 0 || value >= size {
		return 0, fmt.Errorf("%w: random source returned %d for IntN(%d)", ErrInvalidStagePlan, value, size)
	}
	return value, nil
}
