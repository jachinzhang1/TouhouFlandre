package core_test

import (
	"testing"
	"time"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
)

type fakeRoomPolicy struct{}

func (fakeRoomPolicy) PrepareRoom(config core.RoomConfig) (core.RoomConfig, error) {
	return config, nil
}

func (fakeRoomPolicy) ReadyRoster(roster []core.RosterMember, _ int) bool {
	return len(roster) == 1 && roster[0].Connected && roster[0].Ready
}

func TestRegistrySupportsPartialFakeMode(t *testing.T) {
	registry := core.NewRegistry()
	mode := core.Mode("fake")
	ref := core.RuleSetRef{Mode: mode, Key: "probe", Version: 1}
	if err := registry.RegisterRuleSet(ref); err != nil {
		t.Fatal(err)
	}
	if err := registry.RegisterRoomPolicy(mode, fakeRoomPolicy{}); err != nil {
		t.Fatal(err)
	}
	policy, err := registry.RoomPolicy(mode)
	if err != nil {
		t.Fatal(err)
	}
	if !policy.ReadyRoster([]core.RosterMember{{Connected: true, Ready: true}}, 1) {
		t.Fatal("fake room policy was not resolved")
	}
	if _, err := registry.CommandHandler(mode); !core.HasErrorCode(err, core.ErrorMissingCapability) {
		t.Fatalf("missing command capability error = %v", err)
	}
	if err := registry.ValidateRuleSet(ref); err != nil {
		t.Fatalf("fake ruleset should be executable: %v", err)
	}
}

func TestRegistryCanProbeFutureRelayRuleWithoutProductionBehavior(t *testing.T) {
	registry := core.NewRegistry()
	ref := core.RuleSetRef{Mode: core.ModeRelay, Key: "fixed_points", Version: 1}
	if err := registry.RegisterRuleSet(ref); err != nil {
		t.Fatal(err)
	}
	if err := registry.RegisterRoomPolicy(core.ModeRelay, fakeRoomPolicy{}); err != nil {
		t.Fatal(err)
	}
	if err := registry.ValidateRuleSet(ref); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.MatchFactory(core.ModeRelay); !core.HasErrorCode(err, core.ErrorMissingCapability) {
		t.Fatalf("future relay probe unexpectedly executable: %v", err)
	}
}

func TestRegistryRejectsDuplicateCapability(t *testing.T) {
	registry := core.NewRegistry()
	if err := registry.RegisterRoomPolicy(core.Mode("fake"), fakeRoomPolicy{}); err != nil {
		t.Fatal(err)
	}
	if err := registry.RegisterRoomPolicy(core.Mode("fake"), fakeRoomPolicy{}); !core.HasErrorCode(err, core.ErrorDuplicateRegistration) {
		t.Fatalf("duplicate registration error = %v", err)
	}
}

func TestRuleSetRefFailsClosed(t *testing.T) {
	registry := core.NewRegistry()
	known := core.RuleSetRef{Mode: core.ModeRace, Key: "wins", Version: 1}
	if err := registry.RegisterRuleSet(known); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name string
		ref  core.RuleSetRef
		code core.ErrorCode
	}{
		{name: "missing", ref: core.RuleSetRef{}, code: core.ErrorMissingRuleSet},
		{name: "unknown mode", ref: core.RuleSetRef{Mode: "fake", Key: "wins", Version: 1}, code: core.ErrorUnknownMode},
		{name: "unknown key", ref: core.RuleSetRef{Mode: core.ModeRace, Key: "other", Version: 1}, code: core.ErrorUnknownRuleSetKey},
		{name: "unknown version", ref: core.RuleSetRef{Mode: core.ModeRace, Key: "wins", Version: 2}, code: core.ErrorUnknownRuleSetVersion},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := registry.ValidateRuleSet(test.ref); !core.HasErrorCode(err, test.code) {
				t.Fatalf("ValidateRuleSet(%+v) error = %v, want %s", test.ref, err, test.code)
			}
		})
	}
}

type fixedClock struct{ value time.Time }

func (c fixedClock) Now() time.Time { return c.value }

type fixedRandom struct{ value int }

func (r fixedRandom) IntN(n int) int { return r.value % n }

func TestClockAndRandomPortsAreDeterministic(t *testing.T) {
	want := time.Date(2026, 8, 23, 12, 0, 0, 0, time.UTC)
	var clock core.Clock = fixedClock{value: want}
	var random core.RandomSource = fixedRandom{value: 5}
	if got := clock.Now(); !got.Equal(want) {
		t.Fatalf("clock.Now() = %s, want %s", got, want)
	}
	if got := random.IntN(4); got != 1 {
		t.Fatalf("random.IntN(4) = %d, want 1", got)
	}
}
