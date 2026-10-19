package game

import (
	"context"
	"errors"
	"sync"

	"github.com/TouhouFlandre/touhouflandre/apps/api/guessing"
)

type AnswerMatchPolicy = guessing.AnswerMatchPolicy

const (
	AnswerMatchStrict         = guessing.AnswerMatchStrict
	AnswerMatchPublicFieldsV1 = guessing.AnswerMatchPublicFieldsV1
)

func ParseAnswerMatchPolicy(value string) (AnswerMatchPolicy, error) {
	return guessing.ParseAnswerMatchPolicy(value)
}

type MatchResult = guessing.MatchResult

// CatalogRuntime pairs the immutable rule engine with application catalog data.
// Version and Policy identify the frozen snapshot; Characters and ByID supply
// presentation and question-selection metadata and must be treated as read-only.
type CatalogRuntime struct {
	Version    string
	Policy     AnswerMatchPolicy
	Characters []Character
	ByID       map[string]Character
	engine     *guessing.Catalog
}

func BuildCatalogRuntime(version string, policy AnswerMatchPolicy, characters []Character) (*CatalogRuntime, error) {
	entries := make([]guessing.Character, len(characters))
	for i, character := range characters {
		entries[i] = ruleCharacter(character)
	}
	engine, err := guessing.NewCatalog(policy, entries)
	if err != nil {
		return nil, err
	}
	runtime := &CatalogRuntime{
		Version: version, Policy: policy, Characters: append([]Character{}, characters...),
		ByID: make(map[string]Character, len(characters)), engine: engine,
	}
	for _, character := range characters {
		runtime.ByID[character.ID] = character
	}
	return runtime, nil
}

func (runtime *CatalogRuntime) GroupKey(characterID string) string {
	return runtime.engine.GroupKey(characterID)
}

func (runtime *CatalogRuntime) DistinctIDsByGroup(ids []string) []string {
	return runtime.engine.DistinctIDsByGroup(ids)
}

func (runtime *CatalogRuntime) Match(answerID, guessID string) (MatchResult, error) {
	return runtime.engine.Match(answerID, guessID)
}

type CatalogLoader func(context.Context, string) ([]Character, error)

var ErrCatalogRuntimeLoaderMissing = errors.New("catalog runtime loader is nil")

type catalogRuntimeKey struct {
	version string
	policy  AnswerMatchPolicy
}

type catalogRuntimeLoad struct {
	done    chan struct{}
	runtime *CatalogRuntime
	err     error
}

type CatalogRuntimeProvider struct {
	loader CatalogLoader
	mu     sync.Mutex
	cache  map[catalogRuntimeKey]*CatalogRuntime
	loads  map[catalogRuntimeKey]*catalogRuntimeLoad
}

func NewCatalogRuntimeProvider(loader CatalogLoader) *CatalogRuntimeProvider {
	return &CatalogRuntimeProvider{
		loader: loader,
		cache:  make(map[catalogRuntimeKey]*CatalogRuntime),
		loads:  make(map[catalogRuntimeKey]*catalogRuntimeLoad),
	}
}

func (provider *CatalogRuntimeProvider) Get(ctx context.Context, version string, policy AnswerMatchPolicy) (*CatalogRuntime, error) {
	return provider.GetWithLoader(ctx, version, policy, provider.loader)
}

func (provider *CatalogRuntimeProvider) GetWithLoader(ctx context.Context, version string, policy AnswerMatchPolicy, loader CatalogLoader) (*CatalogRuntime, error) {
	if loader == nil {
		return nil, ErrCatalogRuntimeLoaderMissing
	}
	key := catalogRuntimeKey{version: version, policy: policy}
	provider.mu.Lock()
	if runtime := provider.cache[key]; runtime != nil {
		provider.mu.Unlock()
		return runtime, nil
	}
	if load := provider.loads[key]; load != nil {
		provider.mu.Unlock()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-load.done:
			return load.runtime, load.err
		}
	}
	load := &catalogRuntimeLoad{done: make(chan struct{})}
	provider.loads[key] = load
	provider.mu.Unlock()

	characters, err := loader(ctx, version)
	if err == nil {
		load.runtime, err = BuildCatalogRuntime(version, policy, characters)
	}
	load.err = err

	provider.mu.Lock()
	delete(provider.loads, key)
	if err == nil {
		provider.cache[key] = load.runtime
	}
	close(load.done)
	provider.mu.Unlock()
	return load.runtime, load.err
}

var (
	ErrGuessCharacterMissing  = guessing.ErrGuessCharacterMissing
	ErrGuessCharacterDisabled = guessing.ErrGuessCharacterDisabled
	ErrAnswerCharacterMissing = guessing.ErrAnswerCharacterMissing
)

type GuessEvaluator struct {
	catalogs *CatalogRuntimeProvider
}

func NewGuessEvaluator(catalogs *CatalogRuntimeProvider) *GuessEvaluator {
	return &GuessEvaluator{catalogs: catalogs}
}

func (evaluator *GuessEvaluator) Evaluate(
	ctx context.Context,
	catalogVersion string,
	policy AnswerMatchPolicy,
	answerID string,
	guessID string,
	fields []GuessField,
) (GuessResult, error) {
	runtime, err := evaluator.catalogs.Get(ctx, catalogVersion, policy)
	if err != nil {
		return GuessResult{}, err
	}
	return evaluateGuess(runtime, answerID, guessID, fields)
}

// EvaluateRulesWithLoader returns semantic feedback for callers that persist
// statuses and build their own views, such as the multiplayer adapters.
func (evaluator *GuessEvaluator) EvaluateRulesWithLoader(
	ctx context.Context,
	catalogVersion string,
	policy AnswerMatchPolicy,
	answerID string,
	guessID string,
	fields []GuessField,
	loader CatalogLoader,
) (guessing.Result, error) {
	runtime, err := evaluator.catalogs.GetWithLoader(ctx, catalogVersion, policy, loader)
	if err != nil {
		return guessing.Result{}, err
	}
	return runtime.engine.Evaluate(answerID, guessID, ruleFields(fields))
}

func evaluateGuess(runtime *CatalogRuntime, answerID, guessID string, fields []GuessField) (GuessResult, error) {
	result, err := runtime.engine.Evaluate(answerID, guessID, ruleFields(fields))
	if err != nil {
		return GuessResult{}, err
	}
	return presentGuess(runtime.ByID[guessID], fields, result), nil
}

// GuessAttempt combines application presentation with a storage-free attempt
// transition. Persist State and Guess atomically in the calling application.
type GuessAttempt struct {
	State guessing.AttemptState
	Guess GuessResult
}

func (evaluator *GuessEvaluator) ApplyGuess(
	ctx context.Context,
	state guessing.AttemptState,
	catalogVersion string,
	policy AnswerMatchPolicy,
	answerID, guessID string,
	fields []GuessField,
) (GuessAttempt, error) {
	runtime, err := evaluator.catalogs.Get(ctx, catalogVersion, policy)
	if err != nil {
		return GuessAttempt{}, err
	}
	outcome, err := runtime.engine.ApplyGuess(state, answerID, guessID, ruleFields(fields))
	if err != nil {
		return GuessAttempt{}, err
	}
	return GuessAttempt{
		State: outcome.State,
		Guess: presentGuess(runtime.ByID[guessID], fields, outcome.Guess),
	}, nil
}

func MatchKindForStoredGuess(correct bool, answerID, guessID string) MatchKind {
	if !correct {
		return MatchNone
	}
	if answerID == guessID {
		return MatchExact
	}
	return MatchEquivalent
}
