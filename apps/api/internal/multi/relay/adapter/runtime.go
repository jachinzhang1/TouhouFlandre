package adapter

import (
	"github.com/jackc/pgx/v5/pgxpool"

	legacy "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
	relaydomain "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay"
)

func NewRuntime(pool *pgxpool.Pool, clock core.Clock, random core.RandomSource, timing legacy.TimingConfig) (*relaydomain.StageCoordinator, *EncounterService, error) {
	if clock == nil {
		clock = core.SystemClock{}
	}
	if random == nil {
		random = core.NewRandomSource()
	}
	repository := NewStageRepository(pool, timing.FinishedRetention)
	coordinator, err := relaydomain.NewStageCoordinator(
		repository,
		relaydomain.RandomPairingPolicy{},
		NewEncounterProvisioner(pool, random, timing.RoundSeconds),
		relaydomain.LegacyWinsPolicy{},
		clock,
		random,
		relaydomain.IDSourceFunc(legacy.NewID),
		timing.Intermission,
	)
	if err != nil {
		return nil, nil, err
	}
	return coordinator, NewEncounterService(pool, clock, coordinator, timing.FinishedRetention), nil
}
