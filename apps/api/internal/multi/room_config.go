package multi

import (
	"context"
	"errors"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/jackc/pgx/v5"
)

// RelayRoomConfigView is an opaque storage result for shared room projection
// code. Relay policy code owns the meaning of the flag; shared infrastructure
// only carries the typed value through persistence and projection.
type RelayRoomConfigView struct {
	EliminationEnabled bool
}

func LoadRelayRoomConfig(ctx context.Context, q *repo.Queries, roomID string) (RelayRoomConfigView, error) {
	row, err := q.GetRelayRoomConfig(ctx, roomID)
	if errors.Is(err, pgx.ErrNoRows) {
		// Pre-MRX-004 fixtures and an older binary may not have a row yet.
		return RelayRoomConfigView{}, nil
	}
	if err != nil {
		return RelayRoomConfigView{}, err
	}
	return RelayRoomConfigView{EliminationEnabled: row.EliminationEnabled}, nil
}

// RelayRoomConfigForRoom avoids touching relay-owned storage for other modes.
func RelayRoomConfigForRoom(ctx context.Context, q *repo.Queries, room repo.MultiRoom) (RelayRoomConfigView, error) {
	if MultiplayerMode(room.Mode) != MultiplayerModeRelay {
		return RelayRoomConfigView{}, nil
	}
	return LoadRelayRoomConfig(ctx, q, room.ID)
}
