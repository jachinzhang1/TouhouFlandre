package multi

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
)

type RelayTimeoutResult struct {
	Round       repo.MultiRound
	RoundEnded  bool
	ExpiredSlot int
}

type relaySkipKind struct {
	turnKind  RelayTurnKind
	eventType EventType
}

func RelayTurnExpired(round repo.MultiRound, now time.Time) bool {
	return round.Status == string(RoundStatusPlaying) &&
		round.TurnSlot.Valid &&
		round.TurnDeadline.Valid &&
		!now.Before(round.TurnDeadline.Time)
}

// RelayTurnCounts 返回当前局双方已消耗轮次与 member slot 映射。
func RelayTurnCounts(ctx context.Context, q *repo.Queries, roomID, roundID string) ([2]int, map[int]repo.MultiMember, error) {
	members, err := q.ListMembers(ctx, roomID)
	if err != nil {
		return [2]int{}, nil, err
	}
	membersBySlot := map[int]repo.MultiMember{}
	for _, member := range members {
		membersBySlot[MemberSeat(member)] = member
	}
	counts := [2]int{}
	for slot := 1; slot <= 2; slot++ {
		member, ok := membersBySlot[slot]
		if !ok {
			continue
		}
		count, err := q.CountTurnsForRoundMember(ctx, repo.CountTurnsForRoundMemberParams{RoundID: roundID, MemberID: member.ID})
		if err != nil {
			return [2]int{}, nil, err
		}
		counts[slot-1] = int(count)
	}
	return counts, membersBySlot, nil
}

// SettleExpiredRelayTurnTx 结算当前已过期的接力轮次：写 timeout 行、推进下一手或结束本局。
func SettleExpiredRelayTurnTx(ctx context.Context, q *repo.Queries, room repo.MultiRoom, round repo.MultiRound, match repo.MultiMatch, now time.Time, timing TimingConfig) (RelayTimeoutResult, error) {
	return settleRelaySkippedTurnTx(ctx, q, room, round, match, now, timing, relaySkipKind{
		turnKind:  RelayTurnKindTimeout,
		eventType: EventRoundTurnTimeout,
	}, round.TurnDeadline.Time.Add(time.Duration(room.TurnSeconds)*time.Second))
}

func SettlePassedRelayTurnTx(ctx context.Context, q *repo.Queries, room repo.MultiRoom, round repo.MultiRound, match repo.MultiMatch, member repo.MultiMember, now time.Time, timing TimingConfig) (RelayTimeoutResult, error) {
	return settleRelaySkippedTurnTx(ctx, q, room, round, match, now, timing, relaySkipKind{
		turnKind:  RelayTurnKindPass,
		eventType: EventRoundTurnPass,
	}, now.Add(time.Duration(room.TurnSeconds)*time.Second), member)
}

func settleRelaySkippedTurnTx(ctx context.Context, q *repo.Queries, room repo.MultiRoom, round repo.MultiRound, match repo.MultiMatch, now time.Time, timing TimingConfig, kind relaySkipKind, nextDeadline time.Time, memberOverride ...repo.MultiMember) (RelayTimeoutResult, error) {
	if !round.TurnSlot.Valid || !round.TurnDeadline.Valid {
		return RelayTimeoutResult{}, errors.New("relay: current turn missing")
	}
	expiredSlot := int(round.TurnSlot.Int32)
	members, err := q.ListMembers(ctx, room.ID)
	if err != nil {
		return RelayTimeoutResult{}, err
	}
	var member repo.MultiMember
	if len(memberOverride) > 0 {
		member = memberOverride[0]
	} else {
		found := false
		for _, candidate := range members {
			if MemberSeat(candidate) == expiredSlot {
				member = candidate
				found = true
				break
			}
		}
		if !found {
			return RelayTimeoutResult{}, errors.New("relay: timeout member missing")
		}
	}
	skipCountBefore, err := q.CountSkipsForRoundMember(ctx, repo.CountSkipsForRoundMemberParams{RoundID: round.ID, MemberID: member.ID})
	if err != nil {
		return RelayTimeoutResult{}, err
	}
	turnCount, err := q.CountTurnsForRound(ctx, round.ID)
	if err != nil {
		return RelayTimeoutResult{}, err
	}
	turnIndex := int(turnCount) + 1
	turn, err := q.InsertTurn(ctx, repo.InsertTurnParams{
		ID:        NewID(),
		RoundID:   round.ID,
		MemberID:  member.ID,
		TurnIndex: int32(turnIndex),
		Kind:      string(kind.turnKind),
	})
	if err != nil {
		return RelayTimeoutResult{}, err
	}
	counts, membersBySlot, err := RelayTurnCounts(ctx, q, room.ID, round.ID)
	if err != nil {
		return RelayTimeoutResult{}, err
	}
	memberSlot := MemberSeat(member)
	row := RelayTurnRow{Index: int(turn.TurnIndex), MemberID: member.ID, Seat: memberSlot, Kind: kind.turnKind}
	var nextTurnMemberID *string
	var nextTurnSlot *int
	var nextTurnDeadline *time.Time
	maxTurnsPerPlayer := MaxGuessesForMatch(match)
	if skipCountBefore >= RelayMaxSkipsPerPlayer {
		if err := AppendEvent(ctx, q, room.ID, kind.eventType, relaySkipPayload(kind.turnKind, match, round, row, nil, nil, nil)); err != nil {
			return RelayTimeoutResult{}, err
		}
		if _, err := CompleteRoundTx(ctx, q, room, round, match, OtherSlot(memberSlot), now, timing); err != nil {
			return RelayTimeoutResult{}, err
		}
		return RelayTimeoutResult{Round: round, RoundEnded: true, ExpiredSlot: memberSlot}, nil
	}
	advance := AdvanceRelayTurn(false, memberSlot, counts, maxTurnsPerPlayer)
	if !advance.RoundEnded {
		nextSlot := advance.NextTurnSlot
		nextMember, ok := membersBySlot[nextSlot]
		if !ok {
			return RelayTimeoutResult{}, errors.New("relay: next member missing")
		}
		updated, err := q.UpdateRoundTurn(ctx, repo.UpdateRoundTurnParams{
			ID:           round.ID,
			TurnSlot:     pgtype.Int4{Int32: int32(nextSlot), Valid: true},
			TurnDeadline: pgtype.Timestamptz{Time: nextDeadline, Valid: true},
		})
		if err != nil {
			return RelayTimeoutResult{}, err
		}
		round = updated
		nextMemberID := nextMember.ID
		nextTurnMemberID = &nextMemberID
		nextTurnSlot = &nextSlot
		nextTurnDeadline = &nextDeadline
	}
	if err := AppendEvent(ctx, q, room.ID, kind.eventType, relaySkipPayload(kind.turnKind, match, round, row, nextTurnMemberID, nextTurnSlot, nextTurnDeadline)); err != nil {
		return RelayTimeoutResult{}, err
	}
	if advance.RoundEnded {
		if _, err := CompleteRoundTx(ctx, q, room, round, match, 0, now, timing); err != nil {
			return RelayTimeoutResult{}, err
		}
	}
	return RelayTimeoutResult{Round: round, RoundEnded: advance.RoundEnded, ExpiredSlot: memberSlot}, nil
}

func relaySkipPayload(kind RelayTurnKind, match repo.MultiMatch, round repo.MultiRound, row RelayTurnRow, nextTurnMemberID *string, nextTurnSeat *int, nextTurnDeadline *time.Time) any {
	switch kind {
	case RelayTurnKindPass:
		return RoundTurnPassPayload{
			MatchIndex:       int(match.MatchIndex),
			RoundIndex:       int(round.RoundIndex),
			Row:              row,
			NextTurnMemberID: nextTurnMemberID,
			NextTurnSeat:     nextTurnSeat,
			NextTurnDeadline: nextTurnDeadline,
		}
	default:
		return RoundTurnTimeoutPayload{
			MatchIndex:       int(match.MatchIndex),
			RoundIndex:       int(round.RoundIndex),
			Row:              row,
			NextTurnMemberID: nextTurnMemberID,
			NextTurnSeat:     nextTurnSeat,
			NextTurnDeadline: nextTurnDeadline,
		}
	}
}
