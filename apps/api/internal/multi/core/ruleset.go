package core

import "fmt"

// Mode is the stable multiplayer mode namespace used by the kernel.
type Mode string

const (
	ModeRace  Mode = "race"
	ModeRelay Mode = "relay"
)

// RuleSetRef identifies one immutable, mode-owned ruleset implementation.
type RuleSetRef struct {
	Mode    Mode
	Key     string
	Version int
}

func (r RuleSetRef) String() string {
	return fmt.Sprintf("%s/%s@%d", r.Mode, r.Key, r.Version)
}

// Validate checks required fields only. Registry validation also proves that
// the referenced implementation is executable in the current assembly.
func (r RuleSetRef) Validate() error {
	if r.Mode == "" || r.Key == "" || r.Version == 0 {
		return newError(ErrorMissingRuleSet, r.Mode, r, "", "mode, key, and version are required")
	}
	if r.Version < 0 {
		return newError(ErrorInvalidRuleSet, r.Mode, r, "", "version must be positive")
	}
	return nil
}
