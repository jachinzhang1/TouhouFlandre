package game

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"
)

type AnswerMatchPolicy string

const (
	AnswerMatchStrict         AnswerMatchPolicy = "strict"
	AnswerMatchPublicFieldsV1 AnswerMatchPolicy = "public_fields_v1"
)

func ParseAnswerMatchPolicy(value string) (AnswerMatchPolicy, error) {
	policy := AnswerMatchPolicy(value)
	switch policy {
	case AnswerMatchStrict, AnswerMatchPublicFieldsV1:
		return policy, nil
	default:
		return "", fmt.Errorf("unknown answer match policy %q", value)
	}
}

type MatchResult struct {
	Correct bool
	Kind    MatchKind
}

type AnswerMatcher interface {
	Match(runtime *CatalogRuntime, answerID, guessID string) MatchResult
}

type StrictIdentityMatcher struct{}

func (StrictIdentityMatcher) Match(_ *CatalogRuntime, answerID, guessID string) MatchResult {
	if answerID == guessID {
		return MatchResult{Correct: true, Kind: MatchExact}
	}
	return MatchResult{Kind: MatchNone}
}

type PublicFieldEquivalenceMatcherV1 struct{}

func (PublicFieldEquivalenceMatcherV1) Match(runtime *CatalogRuntime, answerID, guessID string) MatchResult {
	if answerID == guessID {
		return MatchResult{Correct: true, Kind: MatchExact}
	}
	answerGroup, answerOK := runtime.groupByID[answerID]
	guessGroup, guessOK := runtime.groupByID[guessID]
	if answerOK && guessOK && answerGroup == guessGroup {
		return MatchResult{Correct: true, Kind: MatchEquivalent}
	}
	return MatchResult{Kind: MatchNone}
}

func matcherForPolicy(policy AnswerMatchPolicy) (AnswerMatcher, error) {
	switch policy {
	case AnswerMatchStrict:
		return StrictIdentityMatcher{}, nil
	case AnswerMatchPublicFieldsV1:
		return PublicFieldEquivalenceMatcherV1{}, nil
	default:
		return nil, fmt.Errorf("unsupported answer match policy %q", policy)
	}
}

type CatalogRuntime struct {
	Version    string
	Policy     AnswerMatchPolicy
	Characters []Character
	ByID       map[string]Character
	groupByID  map[string]string
}

func BuildCatalogRuntime(version string, policy AnswerMatchPolicy, characters []Character) (*CatalogRuntime, error) {
	if _, err := matcherForPolicy(policy); err != nil {
		return nil, err
	}
	runtime := &CatalogRuntime{
		Version: version, Policy: policy, Characters: append([]Character{}, characters...),
		ByID: make(map[string]Character, len(characters)), groupByID: make(map[string]string, len(characters)),
	}
	bySignature := make(map[string][]string)
	for _, character := range characters {
		if character.ID == "" {
			return nil, errors.New("catalog contains a character without an id")
		}
		if _, duplicate := runtime.ByID[character.ID]; duplicate {
			return nil, fmt.Errorf("catalog contains duplicate character id %q", character.ID)
		}
		runtime.ByID[character.ID] = character
		runtime.groupByID[character.ID] = character.ID
		if policy != AnswerMatchPublicFieldsV1 || !character.EnabledAsGuess {
			continue
		}
		signature, ok := CharacterFields.EquivalenceSignature(character)
		if ok {
			bySignature[signature] = append(bySignature[signature], character.ID)
		}
	}
	for _, members := range bySignature {
		if len(members) < 2 {
			continue
		}
		sort.Strings(members)
		groupKey := "equivalent:" + members[0]
		for _, id := range members {
			runtime.groupByID[id] = groupKey
		}
	}
	return runtime, nil
}

func (runtime *CatalogRuntime) GroupKey(characterID string) string {
	if group, ok := runtime.groupByID[characterID]; ok {
		return group
	}
	return characterID
}

// DistinctIDsByGroup keeps the first ID for each frozen answer-equivalence group.
func (runtime *CatalogRuntime) DistinctIDsByGroup(ids []string) []string {
	seen := make(map[string]struct{}, len(ids))
	result := make([]string, 0, len(ids))
	for _, id := range ids {
		key := runtime.GroupKey(id)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, id)
	}
	return result
}

func (runtime *CatalogRuntime) Match(answerID, guessID string) (MatchResult, error) {
	matcher, err := matcherForPolicy(runtime.Policy)
	if err != nil {
		return MatchResult{}, err
	}
	return matcher.Match(runtime, answerID, guessID), nil
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
	ErrGuessCharacterMissing  = errors.New("guess character missing")
	ErrGuessCharacterDisabled = errors.New("guess character disabled")
	ErrAnswerCharacterMissing = errors.New("answer character missing")
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

func (evaluator *GuessEvaluator) EvaluateWithLoader(
	ctx context.Context,
	catalogVersion string,
	policy AnswerMatchPolicy,
	answerID string,
	guessID string,
	fields []GuessField,
	loader CatalogLoader,
) (GuessResult, error) {
	runtime, err := evaluator.catalogs.GetWithLoader(ctx, catalogVersion, policy, loader)
	if err != nil {
		return GuessResult{}, err
	}
	return evaluateGuess(runtime, answerID, guessID, fields)
}

func evaluateGuess(runtime *CatalogRuntime, answerID, guessID string, fields []GuessField) (GuessResult, error) {
	guess, ok := runtime.ByID[guessID]
	if !ok {
		return GuessResult{}, ErrGuessCharacterMissing
	}
	if !guess.EnabledAsGuess {
		return GuessResult{}, ErrGuessCharacterDisabled
	}
	answer, ok := runtime.ByID[answerID]
	if !ok {
		return GuessResult{}, ErrAnswerCharacterMissing
	}
	match, err := runtime.Match(answerID, guessID)
	if err != nil {
		return GuessResult{}, err
	}
	return CompareCharacterWithMatch(guess, answer, fields, match), nil
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
