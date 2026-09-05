package handler

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
)

func TestShouldResumePuzzle(t *testing.T) {
	daily := repo.GameSession{
		Mode:      "daily",
		PuzzleKey: pgtype.Text{String: "2026-08-28", Valid: true},
	}
	random := repo.GameSession{Mode: "random"}
	tests := []struct {
		name       string
		input      puzzleResolveDecisionInput
		wantResume bool
	}{
		{name: "missing", input: puzzleResolveDecisionInput{Mode: "random"}},
		{name: "random", input: puzzleResolveDecisionInput{Mode: "random", Session: &random, RandomScopeMatches: true}, wantResume: true},
		{name: "random scope mismatch", input: puzzleResolveDecisionInput{Mode: "random", Session: &random}, wantResume: false},
		{name: "random mode mismatch", input: puzzleResolveDecisionInput{Mode: "daily", Session: &random}},
		{name: "daily", input: puzzleResolveDecisionInput{Mode: "daily", DateKey: "2026-08-28", Difficulty: game.QuestionDifficultyNormal, Session: &daily, SessionDifficulty: game.QuestionDifficultyNormal}, wantResume: true},
		{name: "daily date mismatch", input: puzzleResolveDecisionInput{Mode: "daily", DateKey: "2026-08-29", Difficulty: game.QuestionDifficultyNormal, Session: &daily, SessionDifficulty: game.QuestionDifficultyNormal}},
		{name: "daily difficulty mismatch", input: puzzleResolveDecisionInput{Mode: "daily", DateKey: "2026-08-28", Difficulty: game.QuestionDifficultyHard, Session: &daily, SessionDifficulty: game.QuestionDifficultyNormal}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := shouldResumePuzzle(test.input); got != test.wantResume {
				t.Fatalf("shouldResumePuzzle() = %v, want %v", got, test.wantResume)
			}
		})
	}
}

func TestSameQuestionScopeForResumeIgnoresDerivedState(t *testing.T) {
	left := game.QuestionScopeConfig{
		CatalogVersion:       "v1",
		Mode:                 game.QuestionScopeModePreset,
		Difficulty:           game.QuestionDifficultyNormal,
		SelectedCharacterIDs: []string{"a", "b"},
		WorkStates:           []game.QuestionScopeWorkState{{WorkID: "work", State: game.QuestionScopeWorkAll}},
		Rules: game.QuestionScopeRules{
			FieldModes: game.CharacterFields.DefaultFieldModes(),
			TurnLimit:  game.QuestionScopeTurnLimit{Enabled: false, Seconds: 30},
			GuessLimit: game.QuestionScopeGuessLimit{Enabled: true, MaxGuesses: 8},
		},
	}
	right := left
	right.CatalogVersion = "v2"
	right.WorkStates = nil
	if !sameQuestionScopeForResume(left, right) {
		t.Fatal("scope comparison should ignore catalog version and derived work states")
	}

	right.SelectedCharacterIDs = []string{"a"}
	if sameQuestionScopeForResume(left, right) {
		t.Fatal("scope comparison should detect a changed character pool")
	}
	right = left
	right.Rules.GuessLimit.MaxGuesses = 7
	if sameQuestionScopeForResume(left, right) {
		t.Fatal("scope comparison should detect changed guess limits")
	}
	right = left
	right.Rules.FieldModes = make(map[game.GuessFieldKey]string, len(left.Rules.FieldModes))
	for key, mode := range left.Rules.FieldModes {
		right.Rules.FieldModes[key] = mode
	}
	right.Rules.FieldModes[game.FieldSpecies] = game.FieldModeHidden
	if sameQuestionScopeForResume(left, right) {
		t.Fatal("scope comparison should detect changed field modes")
	}
	right = left
	right.Rules.TurnLimit = game.QuestionScopeTurnLimit{Enabled: true, Seconds: 60}
	if sameQuestionScopeForResume(left, right) {
		t.Fatal("scope comparison should detect changed turn limits")
	}
}

func TestNormalizedResolveFingerprint(t *testing.T) {
	resume := "session-1"
	scope := &game.QuestionScopeConfig{CatalogVersion: "v1", SelectedCharacterIDs: []string{"a", "b"}}
	randomNormal, err := normalizedResolveFingerprint("random", &resume, game.QuestionDifficultyNormal, scope)
	if err != nil {
		t.Fatal(err)
	}
	randomHard, err := normalizedResolveFingerprint("random", &resume, game.QuestionDifficultyHard, scope)
	if err != nil {
		t.Fatal(err)
	}
	if randomNormal != randomHard {
		t.Fatal("random fingerprint must ignore difficulty")
	}
	dailyWithScope, err := normalizedResolveFingerprint("daily", &resume, game.QuestionDifficultyNormal, scope)
	if err != nil {
		t.Fatal(err)
	}
	dailyWithoutScope, err := normalizedResolveFingerprint("daily", &resume, game.QuestionDifficultyNormal, nil)
	if err != nil {
		t.Fatal(err)
	}
	if dailyWithScope != dailyWithoutScope {
		t.Fatal("daily fingerprint must ignore question scope")
	}
	if dailyWithScope == randomNormal {
		t.Fatal("mode must participate in the fingerprint")
	}
}

func TestResolveRecordExpired(t *testing.T) {
	now := time.Date(2026, 8, 28, 0, 0, 0, 0, time.UTC)
	if resolveRecordExpired(repo.PuzzleResolveIdempotency{
		ExpiresAt: pgtype.Timestamptz{InfinityModifier: pgtype.Infinity, Valid: true},
	}, now) {
		t.Fatal("infinity must not expire")
	}
	if !resolveRecordExpired(repo.PuzzleResolveIdempotency{
		ExpiresAt: pgtype.Timestamptz{Time: now.Add(-time.Second), Valid: true},
	}, now) {
		t.Fatal("past finite timestamp must expire")
	}
}
