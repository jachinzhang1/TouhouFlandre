package core

import "sync"

// Registry stores capabilities independently so a mode only implements what
// it needs. It contains no imports or switches for concrete game modes.
type Registry struct {
	mu sync.RWMutex

	ruleSets           map[RuleSetRef]struct{}
	roomPolicies       map[Mode]RoomPolicy
	matchFactories     map[Mode]MatchFactory
	ruleSetParsers     map[Mode]RuleSetParser
	commandHandlers    map[Mode]CommandHandler
	completionDrivers  map[Mode]CompletionDriver
	snapshotProjectors map[Mode]SnapshotProjector
	historyReaders     map[Mode]HistoryReader
	recoveryDrivers    map[Mode]RecoveryDriver
}

func NewRegistry() *Registry {
	return &Registry{
		ruleSets:           map[RuleSetRef]struct{}{},
		roomPolicies:       map[Mode]RoomPolicy{},
		matchFactories:     map[Mode]MatchFactory{},
		ruleSetParsers:     map[Mode]RuleSetParser{},
		commandHandlers:    map[Mode]CommandHandler{},
		completionDrivers:  map[Mode]CompletionDriver{},
		snapshotProjectors: map[Mode]SnapshotProjector{},
		historyReaders:     map[Mode]HistoryReader{},
		recoveryDrivers:    map[Mode]RecoveryDriver{},
	}
}

func (r *Registry) RegisterRuleSet(ref RuleSetRef) error {
	if err := ref.Validate(); err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.ruleSets[ref]; exists {
		return duplicateRegistration(ref.Mode, "rule_set:"+ref.String())
	}
	r.ruleSets[ref] = struct{}{}
	return nil
}

func (r *Registry) ValidateRuleSet(ref RuleSetRef) error {
	if err := ref.Validate(); err != nil {
		return err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.ruleSets[ref]; ok {
		return nil
	}
	modeKnown := false
	keyKnown := false
	for registered := range r.ruleSets {
		if registered.Mode != ref.Mode {
			continue
		}
		modeKnown = true
		if registered.Key == ref.Key {
			keyKnown = true
		}
	}
	if !modeKnown {
		return newError(ErrorUnknownMode, ref.Mode, ref, "", "mode has no registered rulesets")
	}
	if !keyKnown {
		return newError(ErrorUnknownRuleSetKey, ref.Mode, ref, "", "ruleset key is not registered")
	}
	return newError(ErrorUnknownRuleSetVersion, ref.Mode, ref, "", "ruleset version is not registered")
}

func (r *Registry) ResolveLegacy(mode Mode, legacyValue string) (RuleSetRef, error) {
	r.mu.RLock()
	modeKnown := false
	for ref := range r.ruleSets {
		if ref.Mode == mode {
			modeKnown = true
			break
		}
	}
	r.mu.RUnlock()
	if !modeKnown {
		return RuleSetRef{}, newError(ErrorUnknownMode, mode, RuleSetRef{Mode: mode}, "rule_set_parser", "mode has no registered rulesets")
	}
	parser, err := r.RuleSetParser(mode)
	if err != nil {
		return RuleSetRef{}, err
	}
	ref, err := parser.ParseLegacy(legacyValue)
	if err != nil {
		return RuleSetRef{}, err
	}
	if ref.Mode != mode {
		return RuleSetRef{}, newError(ErrorInvalidRuleSet, mode, ref, "rule_set_parser", "parser returned a different mode")
	}
	if err := r.ValidateRuleSet(ref); err != nil {
		return RuleSetRef{}, err
	}
	return ref, nil
}

func registerCapability[T any](r *Registry, mode Mode, name string, target map[Mode]T, capability T) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := target[mode]; exists {
		return duplicateRegistration(mode, name)
	}
	target[mode] = capability
	return nil
}

func resolveCapability[T any](r *Registry, mode Mode, name string, target map[Mode]T) (T, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	capability, ok := target[mode]
	if !ok {
		var zero T
		return zero, missingCapability(mode, name)
	}
	return capability, nil
}

func (r *Registry) RegisterRoomPolicy(mode Mode, value RoomPolicy) error {
	return registerCapability(r, mode, "room_policy", r.roomPolicies, value)
}
func (r *Registry) RoomPolicy(mode Mode) (RoomPolicy, error) {
	return resolveCapability(r, mode, "room_policy", r.roomPolicies)
}
func (r *Registry) RegisterMatchFactory(mode Mode, value MatchFactory) error {
	return registerCapability(r, mode, "match_factory", r.matchFactories, value)
}
func (r *Registry) MatchFactory(mode Mode) (MatchFactory, error) {
	return resolveCapability(r, mode, "match_factory", r.matchFactories)
}
func (r *Registry) RegisterRuleSetParser(mode Mode, value RuleSetParser) error {
	return registerCapability(r, mode, "rule_set_parser", r.ruleSetParsers, value)
}
func (r *Registry) RuleSetParser(mode Mode) (RuleSetParser, error) {
	return resolveCapability(r, mode, "rule_set_parser", r.ruleSetParsers)
}
func (r *Registry) RegisterCommandHandler(mode Mode, value CommandHandler) error {
	return registerCapability(r, mode, "command_handler", r.commandHandlers, value)
}
func (r *Registry) CommandHandler(mode Mode) (CommandHandler, error) {
	return resolveCapability(r, mode, "command_handler", r.commandHandlers)
}
func (r *Registry) RegisterCompletionDriver(mode Mode, value CompletionDriver) error {
	return registerCapability(r, mode, "completion_driver", r.completionDrivers, value)
}
func (r *Registry) CompletionDriver(mode Mode) (CompletionDriver, error) {
	return resolveCapability(r, mode, "completion_driver", r.completionDrivers)
}
func (r *Registry) RegisterSnapshotProjector(mode Mode, value SnapshotProjector) error {
	return registerCapability(r, mode, "snapshot_projector", r.snapshotProjectors, value)
}
func (r *Registry) SnapshotProjector(mode Mode) (SnapshotProjector, error) {
	return resolveCapability(r, mode, "snapshot_projector", r.snapshotProjectors)
}
func (r *Registry) RegisterHistoryReader(mode Mode, value HistoryReader) error {
	return registerCapability(r, mode, "history_reader", r.historyReaders, value)
}
func (r *Registry) HistoryReader(mode Mode) (HistoryReader, error) {
	return resolveCapability(r, mode, "history_reader", r.historyReaders)
}
func (r *Registry) RegisterRecoveryDriver(mode Mode, value RecoveryDriver) error {
	return registerCapability(r, mode, "recovery_driver", r.recoveryDrivers, value)
}
func (r *Registry) RecoveryDriver(mode Mode) (RecoveryDriver, error) {
	return resolveCapability(r, mode, "recovery_driver", r.recoveryDrivers)
}
