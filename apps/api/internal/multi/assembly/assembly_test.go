package assembly_test

import (
	"testing"
	"time"

	legacy "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/assembly"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
	raceadapter "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/race/adapter"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay"
)

func TestRaceOnlyAssemblyDoesNotResolveRelay(t *testing.T) {
	registry, err := assembly.RaceOnly()
	if err != nil {
		t.Fatal(err)
	}
	for _, scoring := range []string{"wins", "points", "placement"} {
		ref, err := registry.ResolveLegacy(core.ModeRace, scoring)
		if err != nil {
			t.Fatalf("resolve race %s: %v", scoring, err)
		}
		if ref.Key != scoring || ref.Version != 1 {
			t.Fatalf("race ref = %+v", ref)
		}
	}
	if _, err := registry.ResolveLegacy(core.ModeRelay, "wins"); !core.HasErrorCode(err, core.ErrorUnknownMode) {
		t.Fatalf("relay resolution error = %v", err)
	}
}

func TestRelayOnlyAssemblyDoesNotResolveRace(t *testing.T) {
	registry, err := assembly.RelayOnly()
	if err != nil {
		t.Fatal(err)
	}
	ref, err := registry.ResolveLegacy(core.ModeRelay, "wins")
	if err != nil {
		t.Fatal(err)
	}
	if ref.String() != "relay/legacy_wins@1" {
		t.Fatalf("relay ref = %s", ref)
	}
	if _, err := registry.ResolveLegacy(core.ModeRace, "wins"); !core.HasErrorCode(err, core.ErrorUnknownMode) {
		t.Fatalf("race resolution error = %v", err)
	}
}

func TestProductionAssemblyExecutesFixedPointsButKeepsEliminationDisabled(t *testing.T) {
	registry, err := assembly.Production()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := registry.ResolveLegacy(core.ModeRelay, "points"); !core.HasErrorCode(err, core.ErrorInvalidRuleSet) {
		t.Fatalf("relay points error = %v", err)
	}
	fixed := relay.FixedPointsRuleSet()
	if err := registry.ValidateRuleSet(fixed); err != nil {
		t.Fatalf("registered fixed-points rule error = %v", err)
	}
	if err := registry.ValidateRuleSet(core.RuleSetRef{Mode: core.ModeRelay, Key: "fixed_points", Version: 2}); !core.HasErrorCode(err, core.ErrorUnknownRuleSetVersion) {
		t.Fatalf("unknown future relay version error = %v", err)
	}
	commandHandler, err := registry.CommandHandler(core.ModeRelay)
	if err != nil {
		t.Fatal(err)
	}
	if result, err := commandHandler.Handle(core.CommandContext{RuleSet: fixed, Command: core.CommandGuess}); err != nil || !result.Accepted {
		t.Fatalf("fixed-points relay command result=%+v error=%v", result, err)
	}
	completionDriver, err := registry.CompletionDriver(core.ModeRelay)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := completionDriver.Route(fixed); err != nil {
		t.Fatalf("fixed-points relay completion error = %v", err)
	}
	projector, err := registry.SnapshotProjector(core.ModeRelay)
	if err != nil {
		t.Fatal(err)
	}
	if style, err := projector.Style(fixed); err != nil || style != core.ProjectionRelayShared {
		t.Fatalf("fixed-points projection style=%s error=%v", style, err)
	}
	if _, err := completionDriver.Route(relay.EliminationRuleSet()); !core.HasErrorCode(err, core.ErrorFeatureDisabled) {
		t.Fatalf("elimination completion error = %v", err)
	}
	if _, err := registry.ResolveLegacy(core.Mode("unknown"), "wins"); !core.HasErrorCode(err, core.ErrorUnknownMode) {
		t.Fatalf("unknown mode error = %v", err)
	}
}

func TestRelayMatchFactoryPlansLegacyAndFixedPointsByFrozenRoster(t *testing.T) {
	registry, err := assembly.Production()
	if err != nil {
		t.Fatal(err)
	}
	factory, err := registry.MatchFactory(core.ModeRelay)
	if err != nil {
		t.Fatal(err)
	}
	formats := []struct {
		value  string
		stages int
	}{{"bo1", 1}, {"bo3", 3}, {"bo5", 5}, {"bo7", 7}}
	for _, format := range formats {
		for _, rosterSize := range []int{2, 4, 6, 8} {
			plan, err := factory.Plan(core.MatchPlanInput{
				Mode: core.ModeRelay, Format: format.value, RosterSize: rosterSize,
				MaxRoundsFactor: 3, Now: time.Date(2026, 8, 24, 0, 0, 0, 0, time.UTC),
				RoundCountdown: 5 * time.Second, RoundSeconds: 15 * time.Minute, TurnSeconds: 60,
			})
			if err != nil {
				t.Fatalf("%s roster %d: %v", format.value, rosterSize, err)
			}
			if rosterSize == 2 {
				if plan.RuleSet != relay.LegacyRuleSet() || plan.FirstTurnSeat == nil || plan.MaxRounds != format.stages*3 {
					t.Fatalf("legacy %s plan = %+v", format.value, plan)
				}
				continue
			}
			if plan.RuleSet != relay.FixedPointsRuleSet() || plan.FirstTurnSeat != nil || plan.TurnDeadline != nil || plan.MaxRounds != format.stages {
				t.Fatalf("fixed %s roster %d plan = %+v", format.value, rosterSize, plan)
			}
		}
	}
	for _, rosterSize := range []int{0, 1, 3, 5, 7} {
		if _, err := factory.Plan(core.MatchPlanInput{Mode: core.ModeRelay, Format: "bo3", RosterSize: rosterSize}); !core.HasErrorCode(err, core.ErrorInvalidConfiguration) {
			t.Fatalf("roster %d error = %v", rosterSize, err)
		}
	}
}

func TestCapabilitiesRejectUnregisteredRaceRuleSet(t *testing.T) {
	registry, err := assembly.Production()
	if err != nil {
		t.Fatal(err)
	}
	ref := core.RuleSetRef{Mode: core.ModeRace, Key: "wins", Version: 2}
	commandHandler, err := registry.CommandHandler(core.ModeRace)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := commandHandler.Handle(core.CommandContext{RuleSet: ref, Command: core.CommandGuess}); !core.HasErrorCode(err, core.ErrorInvalidRuleSet) {
		t.Fatalf("race command invalid ruleset error = %v", err)
	}
	completionDriver, err := registry.CompletionDriver(core.ModeRace)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := completionDriver.Route(ref); !core.HasErrorCode(err, core.ErrorInvalidRuleSet) {
		t.Fatalf("race completion invalid ruleset error = %v", err)
	}
}

func TestLegacyRelayPolicyRejectsInvalidPersistedCapacity(t *testing.T) {
	registry, err := assembly.Production()
	if err != nil {
		t.Fatal(err)
	}
	policy, err := registry.RoomPolicy(core.ModeRelay)
	if err != nil {
		t.Fatal(err)
	}
	_, err = policy.PrepareRoom(core.RoomConfig{Mode: core.ModeRelay, PlayerLimit: 4, TurnSeconds: 60})
	if !core.HasErrorCode(err, core.ErrorInvalidConfiguration) {
		t.Fatalf("legacy relay invalid capacity error = %v", err)
	}
}

func TestProductionAssemblyRegistersCapabilitiesIndependently(t *testing.T) {
	registry, err := assembly.Production()
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []core.Mode{core.ModeRace, core.ModeRelay} {
		checks := []struct {
			name string
			err  error
		}{
			{name: "room policy", err: second(registry.RoomPolicy(mode))},
			{name: "match factory", err: second(registry.MatchFactory(mode))},
			{name: "ruleset parser", err: second(registry.RuleSetParser(mode))},
			{name: "command handler", err: second(registry.CommandHandler(mode))},
			{name: "completion driver", err: second(registry.CompletionDriver(mode))},
			{name: "snapshot projector", err: second(registry.SnapshotProjector(mode))},
			{name: "history reader", err: second(registry.HistoryReader(mode))},
			{name: "recovery driver", err: second(registry.RecoveryDriver(mode))},
		}
		for _, check := range checks {
			if check.err != nil {
				t.Fatalf("%s %s: %v", mode, check.name, check.err)
			}
		}
	}
}

func second[T any](_ T, err error) error { return err }

func TestRaceAdapterComposesExistingRaceRules(t *testing.T) {
	module := raceadapter.New()
	rules := module.RulesForScoringMode(string(legacy.ScoringModePoints))
	if !rules.UsesPlacementScoring() || rules.UsesElimination() {
		t.Fatalf("unexpected composed RaceRules behavior")
	}
}

func TestMatchFactoriesUseInjectedTime(t *testing.T) {
	registry, err := assembly.Production()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 8, 23, 8, 0, 0, 0, time.UTC)
	tests := []struct {
		mode       core.Mode
		rosterSize int
		wantTurn   bool
	}{
		{mode: core.ModeRace, rosterSize: 4},
		{mode: core.ModeRelay, rosterSize: 2, wantTurn: true},
	}
	for _, test := range tests {
		factory, err := registry.MatchFactory(test.mode)
		if err != nil {
			t.Fatal(err)
		}
		plan, err := factory.Plan(core.MatchPlanInput{
			Mode: test.mode, Format: "bo3", RosterSize: test.rosterSize,
			MaxRoundsFactor: 3, Now: now, RoundCountdown: 5 * time.Second,
			RoundSeconds: 15 * time.Minute, RaceRoundSeconds: 5 * time.Minute,
			TurnSeconds: 60,
		})
		if err != nil {
			t.Fatal(err)
		}
		if want := now.Add(5 * time.Second); !plan.StartsAt.Equal(want) {
			t.Fatalf("%s startsAt = %s, want %s", test.mode, plan.StartsAt, want)
		}
		if (plan.FirstTurnSeat != nil) != test.wantTurn {
			t.Fatalf("%s first turn present = %t, want %t", test.mode, plan.FirstTurnSeat != nil, test.wantTurn)
		}
	}
}
