package multi

import (
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
)

// InitialTurnParams returns relay turn columns for a newly created round.
func InitialTurnParams(room repo.MultiRoom, roundIndex int, startsAt time.Time) (pgtype.Int4, pgtype.Timestamptz) {
	if MultiplayerMode(room.Mode) != MultiplayerModeRelay {
		return pgtype.Int4{}, pgtype.Timestamptz{}
	}
	slot, deadline := InitialRelayTurn(roundIndex, int(room.TurnSeconds), startsAt)
	return pgtype.Int4{Int32: int32(slot), Valid: true}, pgtype.Timestamptz{Time: deadline, Valid: true}
}

// InitialRelayTurn returns the first turn slot and deadline for a relay round.
func InitialRelayTurn(roundIndex, turnSeconds int, startsAt time.Time) (int, time.Time) {
	return RelayFirstTurnSlot(roundIndex), startsAt.Add(time.Duration(turnSeconds) * time.Second)
}

// AddRelayRoundStartedFields attaches relay-specific fields to round.started payloads.
func AddRelayRoundStartedFields(payload *RoundStartedPayload, room repo.MultiRoom, roundIndex int, startsAt time.Time) {
	if MultiplayerMode(room.Mode) != MultiplayerModeRelay {
		return
	}
	slot, deadline := InitialRelayTurn(roundIndex, int(room.TurnSeconds), startsAt)
	max := payload.MaxGuesses
	if max <= 0 {
		max = GameMaxGuesses
	}
	payload.TurnSlot = &slot
	payload.TurnDeadline = &deadline
	payload.MaxTurnsPerPlayer = &max
}
