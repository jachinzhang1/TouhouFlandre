package guessing_test

import (
	"fmt"

	"github.com/TouhouFlandre/touhouflandre/apps/api/guessing"
)

func ExampleCatalog_Evaluate() {
	catalog, err := guessing.NewCatalog(guessing.AnswerMatchStrict, []guessing.Character{
		{ID: "answer", EnabledAsGuess: true, FirstAppearance: guessing.FirstAppearance{ReleaseYear: 2002}},
		{ID: "guess", EnabledAsGuess: true, FirstAppearance: guessing.FirstAppearance{ReleaseYear: 1997}},
	})
	if err != nil {
		panic(err)
	}
	result, err := catalog.Evaluate("answer", "guess", []guessing.FieldRule{
		{Key: guessing.FieldReleaseYear, CompareStrategy: "numberDirection"},
	})
	if err != nil {
		panic(err)
	}
	fmt.Println(result.GuessID, result.IsCorrect, result.MatchKind)
	fmt.Println(result.Feedback[0].Field, result.Feedback[0].Status)
	// Output:
	// guess false none
	// releaseYear higher
}

func ExampleCatalog_ApplyGuess() {
	catalog, err := guessing.NewCatalog(guessing.AnswerMatchStrict, []guessing.Character{
		{ID: "early", EnabledAsGuess: true, FirstAppearance: guessing.FirstAppearance{ReleaseYear: 1997}},
		{ID: "middle", EnabledAsGuess: true, FirstAppearance: guessing.FirstAppearance{ReleaseYear: 1998}},
		{ID: "target", EnabledAsGuess: true, FirstAppearance: guessing.FirstAppearance{ReleaseYear: 2002}},
	})
	if err != nil {
		panic(err)
	}
	state := guessing.AttemptState{Limit: 3}
	fields := []guessing.FieldRule{
		{Key: guessing.FieldReleaseYear, CompareStrategy: "numberDirection"},
	}
	for _, guessID := range []string{"early", "middle", "target"} {
		outcome, err := catalog.ApplyGuess(state, "target", guessID, fields)
		if err != nil {
			panic(err)
		}
		state = outcome.State
		fmt.Println(state.Used, outcome.Guess.Feedback[0].Status, outcome.Guess.IsCorrect, state.Closed)
	}
	// Output:
	// 1 higher false false
	// 2 higher false false
	// 3 exact true true
}
