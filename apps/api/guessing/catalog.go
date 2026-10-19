package guessing

import (
	"errors"
	"fmt"
	"sort"
)

// AnswerMatchPolicy selects whether only identity or public-field equivalence
// counts as a correct answer.
type AnswerMatchPolicy string

const (
	AnswerMatchStrict         AnswerMatchPolicy = "strict"
	AnswerMatchPublicFieldsV1 AnswerMatchPolicy = "public_fields_v1"
)

// ParseAnswerMatchPolicy rejects unrecognized policy names.
func ParseAnswerMatchPolicy(value string) (AnswerMatchPolicy, error) {
	policy := AnswerMatchPolicy(value)
	switch policy {
	case AnswerMatchStrict, AnswerMatchPublicFieldsV1:
		return policy, nil
	default:
		return "", fmt.Errorf("unknown answer match policy %q", value)
	}
}

var (
	ErrGuessCharacterMissing  = errors.New("guess character missing")
	ErrGuessCharacterDisabled = errors.New("guess character disabled")
	ErrAnswerCharacterMissing = errors.New("answer character missing")
)

// Catalog is an immutable snapshot of characters and answer-equivalence groups.
// Construct it with NewCatalog. Once built, it is safe for concurrent reads.
type Catalog struct {
	policy    AnswerMatchPolicy
	byID      map[string]Character
	groupByID map[string]string
}

// NewCatalog validates and deep-copies the input, then freezes equivalence
// groups. Later changes to input characters cannot affect this catalog. Only
// guessable characters with all six attributes known enter equivalent groups.
func NewCatalog(policy AnswerMatchPolicy, characters []Character) (*Catalog, error) {
	if _, err := ParseAnswerMatchPolicy(string(policy)); err != nil {
		return nil, fmt.Errorf("unsupported answer match policy %q", policy)
	}
	catalog := &Catalog{
		policy:    policy,
		byID:      make(map[string]Character, len(characters)),
		groupByID: make(map[string]string, len(characters)),
	}
	bySignature := make(map[string][]string)
	for _, character := range characters {
		if character.ID == "" {
			return nil, errors.New("catalog contains a character without an id")
		}
		if _, duplicate := catalog.byID[character.ID]; duplicate {
			return nil, fmt.Errorf("catalog contains duplicate character id %q", character.ID)
		}
		character = cloneCharacter(character)
		catalog.byID[character.ID] = character
		catalog.groupByID[character.ID] = character.ID
		if policy != AnswerMatchPublicFieldsV1 || !character.EnabledAsGuess {
			continue
		}
		signature, ok := EquivalenceSignature(character)
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
			catalog.groupByID[id] = groupKey
		}
	}
	return catalog, nil
}

func cloneCharacter(character Character) Character {
	character.Species = append([]string(nil), character.Species...)
	character.Affiliations = append([]string(nil), character.Affiliations...)
	character.Locations = append([]string(nil), character.Locations...)
	character.HairColors = append([]string(nil), character.HairColors...)
	return character
}

// GroupKey returns the frozen answer-equivalence group, or characterID itself
// when it is absent from the catalog or belongs to a singleton group.
func (catalog *Catalog) GroupKey(characterID string) string {
	if group, ok := catalog.groupByID[characterID]; ok {
		return group
	}
	return characterID
}

// DistinctIDsByGroup keeps the first ID for each frozen answer-equivalence group.
func (catalog *Catalog) DistinctIDsByGroup(ids []string) []string {
	seen := make(map[string]struct{}, len(ids))
	result := make([]string, 0, len(ids))
	for _, id := range ids {
		key := catalog.GroupKey(id)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, id)
	}
	return result
}

// Match applies the answer policy to IDs without validating guess eligibility
// or catalog membership. Use Evaluate when accepting a guess submission.
func (catalog *Catalog) Match(answerID, guessID string) (MatchResult, error) {
	switch catalog.policy {
	case AnswerMatchStrict, AnswerMatchPublicFieldsV1:
	default:
		return MatchResult{}, fmt.Errorf("unsupported answer match policy %q", catalog.policy)
	}
	if answerID == guessID {
		return MatchResult{Correct: true, Kind: MatchExact}, nil
	}
	if catalog.policy == AnswerMatchPublicFieldsV1 {
		answerGroup, answerOK := catalog.groupByID[answerID]
		guessGroup, guessOK := catalog.groupByID[guessID]
		if answerOK && guessOK && answerGroup == guessGroup {
			return MatchResult{Correct: true, Kind: MatchEquivalent}, nil
		}
	}
	return MatchResult{Kind: MatchNone}, nil
}

// ValidateGuess checks catalog membership and whether the character may be
// guessed. It does not require an answer or mutate the catalog.
func (catalog *Catalog) ValidateGuess(guessID string) error {
	guess, ok := catalog.byID[guessID]
	if !ok {
		return ErrGuessCharacterMissing
	}
	if !guess.EnabledAsGuess {
		return ErrGuessCharacterDisabled
	}
	return nil
}

// Evaluate validates a guess, matches the answer, and compares the selected
// fields. Nil fields select DefaultFields; a non-nil empty slice gives no
// feedback. Field order and repeated fields are preserved. The field selection
// never changes whether the guess is correct.
func (catalog *Catalog) Evaluate(answerID, guessID string, fields []FieldRule) (Result, error) {
	if err := catalog.ValidateGuess(guessID); err != nil {
		return Result{}, err
	}
	guess := catalog.byID[guessID]
	answer, ok := catalog.byID[answerID]
	if !ok {
		return Result{}, ErrAnswerCharacterMissing
	}
	match, err := catalog.Match(answerID, guessID)
	if err != nil {
		return Result{}, err
	}
	if fields == nil {
		fields = DefaultFields()
	}
	feedback := make([]FieldFeedback, 0, len(fields))
	for _, field := range fields {
		feedback = append(feedback, FieldFeedback{Field: field.Key, Status: CompareField(guess, answer, field)})
	}
	return Result{
		GuessID: guess.ID, IsCorrect: match.Correct, MatchKind: match.Kind, Feedback: feedback,
	}, nil
}
