// Package assembly is the multiplayer composition root. It is the only
// production package that imports and registers both race and relay modules.
package assembly

import (
	"fmt"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
	racedomain "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/race"
	race "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/race/adapter"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay"
	relayadapter "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay/adapter"
)

const (
	ProfileFull      = "full"
	ProfileRaceOnly  = "race-only"
	ProfileRelayOnly = "relay-only"
)

func ForProfile(profile string) (*core.Registry, error) {
	switch profile {
	case ProfileFull:
		return Production()
	case ProfileRaceOnly:
		return RaceOnly()
	case ProfileRelayOnly:
		return RelayOnly()
	default:
		return nil, fmt.Errorf("unknown multiplayer registry profile %q", profile)
	}
}

func RaceOnly() (*core.Registry, error) {
	registry := core.NewRegistry()
	module := race.New()
	for _, ref := range racedomain.SupportedRuleSets() {
		if err := registry.RegisterRuleSet(ref); err != nil {
			return nil, err
		}
	}
	if err := registerRace(registry, module); err != nil {
		return nil, err
	}
	return registry, nil
}

func RelayOnly() (*core.Registry, error) {
	registry := core.NewRegistry()
	module := relayadapter.New()
	for _, ref := range relay.SupportedRuleSets() {
		if err := registry.RegisterRuleSet(ref); err != nil {
			return nil, err
		}
	}
	if err := registerRelay(registry, module); err != nil {
		return nil, err
	}
	return registry, nil
}

func Production() (*core.Registry, error) {
	registry, err := RaceOnly()
	if err != nil {
		return nil, err
	}
	module := relayadapter.New()
	for _, ref := range relay.SupportedRuleSets() {
		if err := registry.RegisterRuleSet(ref); err != nil {
			return nil, err
		}
	}
	if err := registerRelay(registry, module); err != nil {
		return nil, err
	}
	return registry, nil
}

func MustProduction() *core.Registry {
	registry, err := Production()
	if err != nil {
		panic(err)
	}
	return registry
}

func registerRace(registry *core.Registry, module race.Module) error {
	registrations := []func() error{
		func() error { return registry.RegisterRoomPolicy(core.ModeRace, module) },
		func() error { return registry.RegisterMatchFactory(core.ModeRace, module) },
		func() error { return registry.RegisterRuleSetParser(core.ModeRace, module) },
		func() error { return registry.RegisterCommandHandler(core.ModeRace, module) },
		func() error { return registry.RegisterCompletionDriver(core.ModeRace, module) },
		func() error { return registry.RegisterSnapshotProjector(core.ModeRace, module) },
		func() error { return registry.RegisterHistoryReader(core.ModeRace, module) },
		func() error { return registry.RegisterRecoveryDriver(core.ModeRace, race.Recovery(module)) },
	}
	for _, register := range registrations {
		if err := register(); err != nil {
			return err
		}
	}
	return nil
}

func registerRelay(registry *core.Registry, module relayadapter.Module) error {
	registrations := []func() error{
		func() error { return registry.RegisterRoomPolicy(core.ModeRelay, module) },
		func() error { return registry.RegisterMatchFactory(core.ModeRelay, module) },
		func() error { return registry.RegisterRuleSetParser(core.ModeRelay, module) },
		func() error { return registry.RegisterCommandHandler(core.ModeRelay, module) },
		func() error { return registry.RegisterCompletionDriver(core.ModeRelay, module) },
		func() error { return registry.RegisterSnapshotProjector(core.ModeRelay, module) },
		func() error { return registry.RegisterHistoryReader(core.ModeRelay, module) },
		func() error { return registry.RegisterRecoveryDriver(core.ModeRelay, relayadapter.Recovery(module)) },
	}
	for _, register := range registrations {
		if err := register(); err != nil {
			return err
		}
	}
	return nil
}
