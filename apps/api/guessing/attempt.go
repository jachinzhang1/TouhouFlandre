package guessing

import "errors"

var (
	ErrAttemptsClosed      = errors.New("attempt sequence closed")
	ErrDuplicateGuess      = errors.New("duplicate guess")
	ErrAttemptLimitReached = errors.New("attempt limit reached")
	ErrInvalidAttemptState = errors.New("invalid attempt state")
)

// AttemptState describes one caller-defined sequence of attempts. The caller
// chooses the scope of its history and allowance. Used includes accepted guesses
// and any other attempts consumed by the caller, such as confirmed timeouts.
// Limit zero means unlimited attempts. Closed may also be set by the caller to
// prevent further attempts for an external reason.
type AttemptState struct {
	GuessedIDs []string
	Used       int
	Limit      int
	Closed     bool
}

// AttemptOutcome is an accepted guess and the next state of its sequence.
type AttemptOutcome struct {
	State AttemptState
	Guess Result
}

// ApplyGuess validates the sequence, rejects duplicates, and evaluates a guess.
// Only an accepted guess consumes an attempt. A correct guess or an exhausted
// allowance closes this sequence; the caller decides what that means for its
// game. Neither the input state nor its history is mutated.
//
// Sequence errors precede catalog errors. Call Catalog.ValidateGuess first when the
// application needs character validation to precede sequence validation.
func (catalog *Catalog) ApplyGuess(state AttemptState, answerID, guessID string, fields []FieldRule) (AttemptOutcome, error) {
	if err := state.ValidateGuess(guessID); err != nil {
		return AttemptOutcome{}, err
	}
	guess, err := catalog.Evaluate(answerID, guessID, fields)
	if err != nil {
		return AttemptOutcome{}, err
	}
	next := cloneAttemptState(state)
	next.GuessedIDs = append(next.GuessedIDs, guess.GuessID)
	next.Used++
	next.Closed = guess.IsCorrect || attemptLimitReached(next)
	return AttemptOutcome{State: next, Guess: guess}, nil
}

// ValidateGuess checks the attempt sequence without loading a catalog. It lets
// applications reject closed, duplicate or exhausted submissions before I/O.
func (state AttemptState) ValidateGuess(guessID string) error {
	if err := validateAttemptState(state); err != nil {
		return err
	}
	for _, previous := range state.GuessedIDs {
		if previous == guessID {
			return ErrDuplicateGuess
		}
	}
	if attemptLimitReached(state) {
		return ErrAttemptLimitReached
	}
	return nil
}

// ConsumeAttempt consumes one attempt without adding a guessed character. The
// caller must first decide whether a timeout, pass, or other action should count;
// this function has no timing or turn policy. It returns an independent history.
func ConsumeAttempt(state AttemptState) (AttemptState, error) {
	if err := validateAttemptState(state); err != nil {
		return AttemptState{}, err
	}
	if attemptLimitReached(state) {
		return AttemptState{}, ErrAttemptLimitReached
	}
	next := cloneAttemptState(state)
	next.Used++
	next.Closed = attemptLimitReached(next)
	return next, nil
}

func validateAttemptState(state AttemptState) error {
	if state.Closed {
		return ErrAttemptsClosed
	}
	// The next accepted attempt must remain representable, including with an
	// unlimited allowance.
	maxInt := int(^uint(0) >> 1)
	if state.Used < 0 || state.Limit < 0 || state.Used < len(state.GuessedIDs) || state.Used == maxInt {
		return ErrInvalidAttemptState
	}
	return nil
}

func attemptLimitReached(state AttemptState) bool {
	return state.Limit > 0 && state.Used >= state.Limit
}

func cloneAttemptState(state AttemptState) AttemptState {
	state.GuessedIDs = append([]string(nil), state.GuessedIDs...)
	return state
}
