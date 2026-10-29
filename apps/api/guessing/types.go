// Package guessing evaluates character guesses using an in-memory catalog.
// It owns comparison and answer-equivalence rules, without storage, players,
// sessions, transport, or presentation concerns.
package guessing

// FeedbackStatus describes a semantic comparison, independent of its display.
type FeedbackStatus string

const (
	FeedbackExact   FeedbackStatus = "exact"
	FeedbackPartial FeedbackStatus = "partial"
	FeedbackMiss    FeedbackStatus = "miss"
	FeedbackHigher  FeedbackStatus = "higher"
	FeedbackLower   FeedbackStatus = "lower"
	FeedbackUnknown FeedbackStatus = "unknown"
)

// FieldKey identifies a character attribute.
type FieldKey string

const (
	FieldFirstAppearance FieldKey = "firstAppearance"
	FieldReleaseYear     FieldKey = "releaseYear"
	FieldSpecies         FieldKey = "species"
	FieldAffiliations    FieldKey = "affiliations"
	FieldLocations       FieldKey = "locations"
	FieldHairColors      FieldKey = "hairColors"
)

// FirstAppearance contains the first-work attributes needed by the rules.
type FirstAppearance struct {
	WorkID      string
	WorkType    string
	ReleaseYear int
}

// Character contains only attributes that affect guess evaluation.
// EnabledAsGuess controls guess submission and membership in equivalent groups;
// selecting which characters may be answers belongs to the caller.
type Character struct {
	ID              string
	EnabledAsGuess  bool
	FirstAppearance FirstAppearance
	Species         []string
	Affiliations    []string
	Locations       []string
	HairColors      []string
}

// FieldRule selects feedback for an attribute. For releaseYear, "numberExact"
// suppresses direction hints; every other strategy preserves direction hints.
// The remaining supported attributes compare by their fixed field rules.
type FieldRule struct {
	Key             FieldKey
	CompareStrategy string
}

// MatchKind distinguishes an identical answer from an equivalent answer.
type MatchKind string

const (
	MatchNone       MatchKind = "none"
	MatchExact      MatchKind = "exact"
	MatchEquivalent MatchKind = "equivalent"
)

// MatchResult is the answer-policy decision, independent of feedback selection.
type MatchResult struct {
	Correct bool
	Kind    MatchKind
}

// FieldFeedback contains a field's comparison without labels or display values.
type FieldFeedback struct {
	Field  FieldKey
	Status FeedbackStatus
}

// Result is a validated guess and its feedback in the requested field order.
type Result struct {
	GuessID   string
	IsCorrect bool
	MatchKind MatchKind
	Feedback  []FieldFeedback
}
