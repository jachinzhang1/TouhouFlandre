package guessing_test

import (
	"errors"
	"reflect"
	"testing"

	"github.com/TouhouFlandre/touhouflandre/apps/api/guessing"
)

func attemptTestCatalog(t *testing.T) *guessing.Catalog {
	t.Helper()
	catalog, err := guessing.NewCatalog(guessing.AnswerMatchStrict, []guessing.Character{
		{ID: "answer", EnabledAsGuess: true},
		{ID: "wrong", EnabledAsGuess: true},
		{ID: "other", EnabledAsGuess: true},
		{ID: "disabled"},
	})
	if err != nil {
		t.Fatal(err)
	}
	return catalog
}

func TestApplyGuessAdvancesWithoutMutatingHistory(t *testing.T) {
	catalog := attemptTestCatalog(t)
	// Spare capacity makes an accidental append to the caller's slice visible.
	backing := []string{"wrong", "untouched", "untouched"}
	state := guessing.AttemptState{GuessedIDs: backing[:1], Used: 1, Limit: 3}
	fields := []guessing.FieldRule{{Key: guessing.FieldSpecies}}
	outcome, err := catalog.ApplyGuess(state, "answer", "other", fields)
	if err != nil {
		t.Fatal(err)
	}
	wantState := guessing.AttemptState{GuessedIDs: []string{"wrong", "other"}, Used: 2, Limit: 3}
	if !reflect.DeepEqual(outcome.State, wantState) {
		t.Fatalf("state = %#v, want %#v", outcome.State, wantState)
	}
	if outcome.Guess.GuessID != "other" || outcome.Guess.IsCorrect || len(outcome.Guess.Feedback) != 1 || outcome.Guess.Feedback[0].Field != guessing.FieldSpecies {
		t.Fatalf("unexpected guess result: %#v", outcome.Guess)
	}
	outcome.State.GuessedIDs[0] = "modified"
	if !reflect.DeepEqual(backing, []string{"wrong", "untouched", "untouched"}) || state.Used != 1 || state.Closed {
		t.Fatalf("input was mutated: state %#v, backing %#v", state, backing)
	}
}

func TestApplyGuessFinalAttemptCanWin(t *testing.T) {
	outcome, err := attemptTestCatalog(t).ApplyGuess(
		guessing.AttemptState{Used: 2, Limit: 3}, "answer", "answer", nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !outcome.Guess.IsCorrect || outcome.Guess.MatchKind != guessing.MatchExact || outcome.State.Used != 3 || !outcome.State.Closed {
		t.Fatalf("last accepted guess must retain its win: %#v", outcome)
	}
}

func TestApplyGuessMissClosesAtLimit(t *testing.T) {
	outcome, err := attemptTestCatalog(t).ApplyGuess(guessing.AttemptState{Limit: 1}, "answer", "wrong", nil)
	if err != nil {
		t.Fatal(err)
	}
	if outcome.Guess.IsCorrect || outcome.State.Used != 1 || !outcome.State.Closed {
		t.Fatalf("unexpected exhausted sequence: %#v", outcome)
	}
}

func TestApplyGuessRejectedAttemptsDoNotMutateState(t *testing.T) {
	catalog := attemptTestCatalog(t)
	tests := []struct {
		name   string
		state  guessing.AttemptState
		answer string
		guess  string
		want   error
	}{
		{name: "externally closed", state: guessing.AttemptState{Closed: true}, answer: "answer", guess: "wrong", want: guessing.ErrAttemptsClosed},
		{name: "negative used", state: guessing.AttemptState{Used: -1}, answer: "answer", guess: "wrong", want: guessing.ErrInvalidAttemptState},
		{name: "negative limit", state: guessing.AttemptState{Limit: -1}, answer: "answer", guess: "wrong", want: guessing.ErrInvalidAttemptState},
		{name: "history exceeds count", state: guessing.AttemptState{GuessedIDs: []string{"wrong"}}, answer: "answer", guess: "other", want: guessing.ErrInvalidAttemptState},
		{name: "overflow", state: guessing.AttemptState{Used: int(^uint(0) >> 1)}, answer: "answer", guess: "wrong", want: guessing.ErrInvalidAttemptState},
		{name: "duplicate", state: guessing.AttemptState{GuessedIDs: []string{"wrong"}, Used: 1}, answer: "answer", guess: "wrong", want: guessing.ErrDuplicateGuess},
		{name: "duplicate precedes limit", state: guessing.AttemptState{GuessedIDs: []string{"wrong"}, Used: 1, Limit: 1}, answer: "answer", guess: "wrong", want: guessing.ErrDuplicateGuess},
		{name: "at limit", state: guessing.AttemptState{Used: 2, Limit: 2}, answer: "answer", guess: "wrong", want: guessing.ErrAttemptLimitReached},
		{name: "past limit", state: guessing.AttemptState{Used: 3, Limit: 2}, answer: "answer", guess: "wrong", want: guessing.ErrAttemptLimitReached},
		{name: "unknown guess", state: guessing.AttemptState{}, answer: "answer", guess: "unknown", want: guessing.ErrGuessCharacterMissing},
		{name: "disabled guess", state: guessing.AttemptState{}, answer: "answer", guess: "disabled", want: guessing.ErrGuessCharacterDisabled},
		{name: "missing answer", state: guessing.AttemptState{}, answer: "unknown", guess: "wrong", want: guessing.ErrAnswerCharacterMissing},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			before := test.state
			before.GuessedIDs = append([]string(nil), test.state.GuessedIDs...)
			_, err := catalog.ApplyGuess(test.state, test.answer, test.guess, nil)
			if !errors.Is(err, test.want) {
				t.Fatalf("error = %v, want %v", err, test.want)
			}
			if !reflect.DeepEqual(test.state, before) {
				t.Fatalf("rejected guess mutated state: %#v, was %#v", test.state, before)
			}
		})
	}
}

func TestUnlimitedAttemptsRemainOpenUntilCorrect(t *testing.T) {
	catalog := attemptTestCatalog(t)
	state, err := guessing.ConsumeAttempt(guessing.AttemptState{Used: 50})
	if err != nil {
		t.Fatal(err)
	}
	outcome, err := catalog.ApplyGuess(state, "answer", "wrong", nil)
	if err != nil {
		t.Fatal(err)
	}
	if outcome.State.Used != 52 || outcome.State.Closed {
		t.Fatalf("unlimited miss must remain open: %#v", outcome.State)
	}
	outcome, err = catalog.ApplyGuess(outcome.State, "answer", "answer", nil)
	if err != nil {
		t.Fatal(err)
	}
	if outcome.State.Used != 53 || !outcome.State.Closed || !outcome.Guess.IsCorrect {
		t.Fatalf("unlimited correct guess must close: %#v", outcome)
	}
}

func TestConsumeAttemptPreservesGuessesAndClosesAtLimit(t *testing.T) {
	state := guessing.AttemptState{GuessedIDs: []string{"wrong"}, Used: 1, Limit: 2}
	next, err := guessing.ConsumeAttempt(state)
	if err != nil {
		t.Fatal(err)
	}
	if next.Used != 2 || !next.Closed || !reflect.DeepEqual(next.GuessedIDs, []string{"wrong"}) {
		t.Fatalf("unexpected consumed attempt: %#v", next)
	}
	next.GuessedIDs[0] = "modified"
	if state.GuessedIDs[0] != "wrong" || state.Used != 1 || state.Closed {
		t.Fatalf("consuming mutated input: %#v", state)
	}
}

func TestConsumeAttemptRejectsUnavailableSequence(t *testing.T) {
	tests := []struct {
		state guessing.AttemptState
		want  error
	}{
		{state: guessing.AttemptState{Closed: true}, want: guessing.ErrAttemptsClosed},
		{state: guessing.AttemptState{Used: -1}, want: guessing.ErrInvalidAttemptState},
		{state: guessing.AttemptState{Limit: -1}, want: guessing.ErrInvalidAttemptState},
		{state: guessing.AttemptState{GuessedIDs: []string{"wrong"}}, want: guessing.ErrInvalidAttemptState},
		{state: guessing.AttemptState{Used: int(^uint(0) >> 1)}, want: guessing.ErrInvalidAttemptState},
		{state: guessing.AttemptState{Used: 2, Limit: 2}, want: guessing.ErrAttemptLimitReached},
	}
	for _, test := range tests {
		if _, err := guessing.ConsumeAttempt(test.state); !errors.Is(err, test.want) {
			t.Errorf("ConsumeAttempt(%#v) error = %v, want %v", test.state, err, test.want)
		}
	}
}
