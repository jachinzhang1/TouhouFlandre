package server_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/handler"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/seed"
	apiserver "github.com/TouhouFlandre/touhouflandre/apps/api/internal/server"
)

type answerMatchCatalogFixture struct {
	version    string
	answer     game.Character
	equivalent game.Character
	different  game.Character
	disabled   game.Character
	scope      game.QuestionScopeConfig
}

func answerMatchCharacter(id string) game.Character {
	return game.Character{
		ID: id,
		Names: game.LocalizedNames{
			ZhHans: id,
			Ja:     id,
			En:     id,
		},
		FirstAppearance: game.FirstAppearance{
			WorkID: "answer-match-work", WorkTitle: "Answer Match Work",
			WorkType: "game", ReleaseYear: 2000,
		},
		Species: []string{"youkai", "magician"}, Affiliations: []string{"fixture-group"},
		Locations: []string{"fixture-place"}, HairColors: []string{"red", "blue"},
		DifficultyTier: "normal", EnabledAsGuess: true,
	}
}

func ensureAnswerMatchCatalogFixture(t *testing.T) answerMatchCatalogFixture {
	t.Helper()
	answer := answerMatchCharacter("answer-match-answer")
	answer.EnabledAsAnswer = true
	equivalent := answerMatchCharacter("answer-match-equivalent")
	equivalent.Species = []string{"magician", "youkai"}
	equivalent.HairColors = []string{"blue", "red"}
	different := answerMatchCharacter("answer-match-different")
	different.Locations = []string{"different-place"}
	disabled := answerMatchCharacter("answer-match-disabled")
	disabled.EnabledAsGuess = false
	characters := []game.Character{answer, equivalent, different, disabled}
	version := "answer-match-integration-v1"
	raw, err := json.Marshal(characters)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO catalog_snapshot (version, characters)
		VALUES ($1, $2)
		ON CONFLICT (version) DO NOTHING`, version, raw); err != nil {
		t.Fatal(err)
	}
	scope := game.DefaultQuestionScope(
		version,
		[]game.QuestionScopeWork{{ID: answer.FirstAppearance.WorkID}},
		characters,
		game.QuestionDifficultyNormal,
	)
	return answerMatchCatalogFixture{
		version: version, answer: answer, equivalent: equivalent,
		different: different, disabled: disabled, scope: scope,
	}
}

func createAnswerMatchSession(t *testing.T, fixture answerMatchCatalogFixture, policy game.AnswerMatchPolicy) string {
	t.Helper()
	scopeJSON, err := json.Marshal(fixture.scope)
	if err != nil {
		t.Fatal(err)
	}
	sessionID := "answer-match-session-" + multi.NewID()
	if _, err := pool.Exec(ctx, `
		INSERT INTO game_session (
			id, mode, content_type, answer_id, catalog_version, status,
			max_guesses, question_scope, answer_match_policy
		) VALUES ($1, 'random', 'character', $2, $3, 'playing', 8, $4, $5)`,
		sessionID, fixture.answer.ID, fixture.version, scopeJSON, string(policy)); err != nil {
		t.Fatal(err)
	}
	return sessionID
}

func submitSingleGuess(t *testing.T, sessionID, guessID string) openapi.PublicGameSession {
	t.Helper()
	resp, payload := request(http.MethodPost, "/api/sessions/"+sessionID+"/guess", map[string]string{"guessId": guessID})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("single guess %s status %d: %s", guessID, resp.StatusCode, payload)
	}
	var result struct {
		Session openapi.PublicGameSession `json:"session"`
	}
	if err := json.Unmarshal(payload, &result); err != nil {
		t.Fatal(err)
	}
	return result.Session
}

func TestSinglePlayerAnswerMatchingUsesFrozenPolicyAndFullCatalog(t *testing.T) {
	fixture := ensureAnswerMatchCatalogFixture(t)
	publicSessionID := createAnswerMatchSession(t, fixture, game.AnswerMatchPublicFieldsV1)

	playing := submitSingleGuess(t, publicSessionID, fixture.different.ID)
	if playing.Status != openapi.SessionStatusPlaying || len(playing.Guesses) != 1 ||
		playing.Guesses[0].MatchKind != openapi.MatchKindNone {
		t.Fatalf("non-equivalent single guess = %+v", playing)
	}
	disabledResp, disabledPayload := request(
		http.MethodPost,
		"/api/sessions/"+publicSessionID+"/guess",
		map[string]string{"guessId": fixture.disabled.ID},
	)
	if disabledResp.StatusCode != http.StatusBadRequest || decodeError(t, disabledPayload).Code != "INVALID_GUESS" {
		t.Fatalf("disabled guess status %d: %s", disabledResp.StatusCode, disabledPayload)
	}

	won := submitSingleGuess(t, publicSessionID, fixture.equivalent.ID)
	lastGuess := won.Guesses[len(won.Guesses)-1]
	if won.Status != openapi.SessionStatusWon || !lastGuess.IsCorrect || lastGuess.MatchKind != openapi.MatchKindEquivalent {
		t.Fatalf("equivalent single guess = %+v", won)
	}
	if won.Answer == nil || won.Answer.Id != fixture.answer.ID {
		t.Fatalf("single terminal answer = %+v, want %s", won.Answer, fixture.answer.ID)
	}
	if len(fixture.scope.SelectedCharacterIDs) != 1 || fixture.scope.SelectedCharacterIDs[0] != fixture.answer.ID {
		t.Fatalf("fixture answer pool = %v; equivalent guess must remain outside it", fixture.scope.SelectedCharacterIDs)
	}

	strictSessionID := createAnswerMatchSession(t, fixture, game.AnswerMatchStrict)
	strictMiss := submitSingleGuess(t, strictSessionID, fixture.equivalent.ID)
	if strictMiss.Status != openapi.SessionStatusPlaying || strictMiss.Guesses[0].MatchKind != openapi.MatchKindNone {
		t.Fatalf("strict frozen session accepted equivalent guess: %+v", strictMiss)
	}
	strictWin := submitSingleGuess(t, strictSessionID, fixture.answer.ID)
	strictLast := strictWin.Guesses[len(strictWin.Guesses)-1]
	if strictWin.Status != openapi.SessionStatusWon || strictLast.MatchKind != openapi.MatchKindExact {
		t.Fatalf("strict exact guess = %+v", strictWin)
	}

	restoredResp, restoredPayload := request(http.MethodGet, "/api/sessions/"+publicSessionID, nil)
	if restoredResp.StatusCode != http.StatusOK {
		t.Fatalf("restore status %d: %s", restoredResp.StatusCode, restoredPayload)
	}
	var restored struct {
		Session openapi.PublicGameSession `json:"session"`
	}
	if err := json.Unmarshal(restoredPayload, &restored); err != nil {
		t.Fatal(err)
	}
	if got := restored.Session.Guesses[len(restored.Session.Guesses)-1].MatchKind; got != openapi.MatchKindEquivalent {
		t.Fatalf("restored match kind = %s", got)
	}
}

func bindMultiplayerAnswerMatchCatalog(t *testing.T, roomID string, fixture answerMatchCatalogFixture) {
	t.Helper()
	scopeJSON, err := json.Marshal(fixture.scope)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE multi_match
		SET catalog_version = $2,
		    question_scope = $3,
		    answer_match_policy = 'public_fields_v1',
		    rule_config_snapshot = rule_config_snapshot || '{"answerMatchPolicy":"public_fields_v1"}'::jsonb
		WHERE room_id = $1 AND status = 'playing'`, roomID, fixture.version, scopeJSON); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE multi_round AS round
		SET answer_id = $2
		FROM multi_match AS match
		WHERE round.match_id = match.id AND match.room_id = $1 AND match.status = 'playing'`,
		roomID, fixture.answer.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE multi_relay_encounter AS encounter
		SET answer_id = $2
		FROM multi_match AS match
		WHERE encounter.match_id = match.id AND match.room_id = $1 AND match.status = 'playing'`,
		roomID, fixture.answer.ID); err != nil {
		t.Fatal(err)
	}
}

func decodeMultiplayerGuess(t *testing.T, response *http.Response, payload []byte) openapi.GuessResponse {
	t.Helper()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("multiplayer guess status %d: %s", response.StatusCode, payload)
	}
	var accepted openapi.GuessResponse
	if err := json.Unmarshal(payload, &accepted); err != nil {
		t.Fatal(err)
	}
	return accepted
}

func assertRoundEndedWithDrawnAnswer(t *testing.T, fixture matchFixture, answerID string) {
	t.Helper()
	for _, event := range eventsOf(t, fixture) {
		if event.Type != "round.ended" {
			continue
		}
		answer, _ := event.Payload["answer"].(map[string]any)
		if answer["id"] != answerID {
			t.Fatalf("terminal answer = %v, want id %s", answer, answerID)
		}
		return
	}
	t.Fatal("round.ended event missing")
}

func TestRaceAndLegacyRelayAcceptEquivalentGuesses(t *testing.T) {
	fixtureCatalog := ensureAnswerMatchCatalogFixture(t)
	for _, mode := range []string{"race", "relay"} {
		t.Run(mode, func(t *testing.T) {
			fixture := createMatchFixtureMode(t, "bo1", mode, 30)
			startMatch(t, fixture)
			bindMultiplayerAnswerMatchCatalog(t, fixture.roomID, fixtureCatalog)

			firstResponse, firstPayload := guess(
				t, fixture.roomID, fixture.hostToken, 1, fixtureCatalog.different.ID, mode+"-none",
			)
			first := decodeMultiplayerGuess(t, firstResponse, firstPayload)
			if first.Guess.IsCorrect || first.Guess.MatchKind != openapi.MatchKindNone {
				t.Fatalf("%s non-equivalent guess = %+v", mode, first.Guess)
			}
			winningToken := fixture.hostToken
			if mode == "relay" {
				winningToken = fixture.joinerToken
			}
			winningResponse, winningPayload := guess(
				t, fixture.roomID, winningToken, 1, fixtureCatalog.equivalent.ID, mode+"-equivalent",
			)
			winning := decodeMultiplayerGuess(t, winningResponse, winningPayload)
			if !winning.Guess.IsCorrect || winning.Guess.MatchKind != openapi.MatchKindEquivalent {
				t.Fatalf("%s equivalent guess = %+v", mode, winning.Guess)
			}
			if mode == "race" {
				assertRoundEndedWithDrawnAnswer(t, fixture, fixtureCatalog.answer.ID)
				return
			}
			terminal := startMatchSnapshot(t, fixture)
			terminalDetail := (*terminal.Match.Relay.CurrentStage.EncounterDetails)[0]
			if terminalDetail.Answer == nil || terminalDetail.Answer.Id != fixtureCatalog.answer.ID {
				t.Fatalf("relay terminal answer = %+v, want %s", terminalDetail.Answer, fixtureCatalog.answer.ID)
			}
		})
	}
}

func TestEncounterRelayAcceptsEquivalentGuessAndReplaysIt(t *testing.T) {
	fixtureCatalog := ensureAnswerMatchCatalogFixture(t)
	fixture := createMatchFixtureMode(t, "bo1", "relay", 30)
	snapshot := startMatch(t, fixture)
	details := *snapshot.Match.Relay.CurrentStage.EncounterDetails
	if len(details) != 1 {
		t.Fatalf("encounter details = %+v", details)
	}
	detail := details[0]
	bindMultiplayerAnswerMatchCatalog(t, fixture.roomID, fixtureCatalog)
	path := fmt.Sprintf(
		"/api/rooms/%s/stages/1/encounters/%s/actions",
		fixture.roomID,
		detail.EncounterId,
	)

	wrongResp, wrongPayload := fastRequestAuth(http.MethodPost, path, fixture.hostToken, map[string]any{
		"action": "guess", "guessId": fixtureCatalog.different.ID, "idempotencyKey": "encounter-none",
	})
	if wrongResp.StatusCode != http.StatusOK {
		t.Fatalf("encounter wrong guess status %d: %s", wrongResp.StatusCode, wrongPayload)
	}
	var wrong openapi.RelayEncounterActionResponse
	if err := json.Unmarshal(wrongPayload, &wrong); err != nil {
		t.Fatal(err)
	}
	if wrong.Ended || wrong.Turn == nil || wrong.Turn.Guess == nil ||
		wrong.Turn.Guess.IsCorrect || wrong.Turn.Guess.MatchKind != openapi.MatchKindNone {
		t.Fatalf("encounter non-equivalent response = %+v", wrong)
	}

	body := map[string]any{
		"action": "guess", "guessId": fixtureCatalog.equivalent.ID, "idempotencyKey": "encounter-equivalent",
	}
	for attempt := 0; attempt < 2; attempt++ {
		resp, payload := fastRequestAuth(http.MethodPost, path, fixture.joinerToken, body)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("encounter equivalent attempt %d status %d: %s", attempt, resp.StatusCode, payload)
		}
		var accepted openapi.RelayEncounterActionResponse
		if err := json.Unmarshal(payload, &accepted); err != nil {
			t.Fatal(err)
		}
		if !accepted.Ended || accepted.Turn == nil || accepted.Turn.Guess == nil ||
			!accepted.Turn.Guess.IsCorrect || accepted.Turn.Guess.MatchKind != openapi.MatchKindEquivalent {
			t.Fatalf("encounter equivalent attempt %d = %+v", attempt, accepted)
		}
	}
	terminal := startMatchSnapshot(t, fixture)
	terminalDetail := (*terminal.Match.Relay.CurrentStage.EncounterDetails)[0]
	if terminalDetail.Answer == nil || terminalDetail.Answer.Id != fixtureCatalog.answer.ID {
		t.Fatalf("encounter terminal answer = %+v, want %s", terminalDetail.Answer, fixtureCatalog.answer.ID)
	}
}

func postDailyAtServer(t *testing.T, target *httptest.Server) openapi.PuzzleResponse {
	t.Helper()
	resp, err := target.Client().Post(target.URL+"/api/puzzles/daily", "application/json", bytes.NewReader([]byte(`{}`)))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("daily status %d: %s", resp.StatusCode, payload)
	}
	var created openapi.PuzzleResponse
	if err := json.Unmarshal(payload, &created); err != nil {
		t.Fatal(err)
	}
	return created
}

func TestDailyPuzzleFreezesAndSharesAnswerMatchPolicy(t *testing.T) {
	clock := core.ClockFunc(func() time.Time {
		return time.Date(2099, time.January, 2, 12, 0, 0, 0, time.UTC)
	})
	strictServer := httptest.NewServer(apiserver.NewWithOptions(
		pool,
		handler.WithAnswerMatchPolicy(game.AnswerMatchStrict),
		handler.WithMultiplayerKernel(nil, clock, nil),
	))
	first := postDailyAtServer(t, strictServer)
	strictServer.Close()

	publicServer := httptest.NewServer(apiserver.NewWithOptions(
		pool,
		handler.WithAnswerMatchPolicy(game.AnswerMatchPublicFieldsV1),
		handler.WithMultiplayerKernel(nil, clock, nil),
	))
	defer publicServer.Close()
	second := postDailyAtServer(t, publicServer)
	if first.Session.PuzzleKey == nil || second.Session.PuzzleKey == nil ||
		*first.Session.PuzzleKey != *second.Session.PuzzleKey {
		t.Fatalf("daily puzzle keys differ: %+v / %+v", first.Session.PuzzleKey, second.Session.PuzzleKey)
	}

	for _, sessionID := range []string{first.Session.Id, second.Session.Id} {
		var policy string
		if err := pool.QueryRow(ctx, `SELECT answer_match_policy FROM game_session WHERE id = $1`, sessionID).Scan(&policy); err != nil {
			t.Fatal(err)
		}
		if policy != string(game.AnswerMatchStrict) {
			t.Fatalf("daily session %s policy = %s, want strict", sessionID, policy)
		}
	}
	var puzzlePolicy string
	if err := pool.QueryRow(ctx, `SELECT answer_match_policy FROM daily_puzzle WHERE date_key = $1`, *first.Session.PuzzleKey).Scan(&puzzlePolicy); err != nil {
		t.Fatal(err)
	}
	if puzzlePolicy != string(game.AnswerMatchStrict) {
		t.Fatalf("daily puzzle policy = %s, want strict", puzzlePolicy)
	}
}

func answerMatchRepositoryRoot(t *testing.T) string {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("locate answer-match integration test")
	}
	return filepath.Join(filepath.Dir(filename), "..", "..", "..", "..")
}

func findKnownNonEquivalentPair(t *testing.T, characters []game.Character) (game.Character, game.Character) {
	t.Helper()
	for _, answer := range characters {
		if !answer.EnabledAsAnswer || !answer.EnabledAsGuess || !game.CharacterFields.Equivalent(answer, answer) {
			continue
		}
		for _, guess := range characters {
			if guess.ID != answer.ID && guess.EnabledAsGuess && !game.CharacterFields.Equivalent(answer, guess) {
				return answer, guess
			}
		}
	}
	t.Fatal("catalog has no suitable known, non-equivalent character pair")
	return game.Character{}, game.Character{}
}

func writeHotUpdateCatalog(t *testing.T, sourceDir string, answer, guess game.Character) string {
	t.Helper()
	targetDir := t.TempDir()
	works, err := os.ReadFile(filepath.Join(sourceDir, "works.demo.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(targetDir, "works.demo.json"), works, 0o600); err != nil {
		t.Fatal(err)
	}
	charactersRaw, err := os.ReadFile(filepath.Join(sourceDir, "characters.demo.json"))
	if err != nil {
		t.Fatal(err)
	}
	var characters []map[string]any
	if err := json.Unmarshal(charactersRaw, &characters); err != nil {
		t.Fatal(err)
	}
	byID := make(map[string]map[string]any, len(characters))
	for _, character := range characters {
		id, _ := character["id"].(string)
		byID[id] = character
	}
	answerSource := byID[answer.ID]
	guessSource := byID[guess.ID]
	if answerSource == nil || guessSource == nil {
		t.Fatalf("source catalog does not contain %s/%s", answer.ID, guess.ID)
	}
	firstAppearance, ok := answerSource["firstAppearance"].(map[string]any)
	if !ok {
		t.Fatalf("answer %s has invalid firstAppearance", answer.ID)
	}
	guessSource["firstAppearance"] = map[string]any{"workId": firstAppearance["workId"]}
	for _, key := range []string{"species", "affiliations", "locations", "hairColors"} {
		guessSource[key] = answerSource[key]
	}
	modified, err := json.MarshalIndent(characters, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(targetDir, "characters.demo.json"), modified, 0o600); err != nil {
		t.Fatal(err)
	}
	return targetDir
}

func TestSeedHotUpdateBuildsNewIndexWithoutRestartingAPI(t *testing.T) {
	var oldVersion string
	if err := pool.QueryRow(ctx, `SELECT current_version FROM catalog_state WHERE id = 'current'`).Scan(&oldVersion); err != nil {
		t.Fatal(err)
	}
	oldCharacters := catalogCharactersForVersion(t, oldVersion)
	answer, guess := findKnownNonEquivalentPair(t, oldCharacters)
	oldScope := game.DefaultQuestionScope(oldVersion, nil, oldCharacters, game.QuestionDifficultyNormal)
	oldSessionID := createAnswerMatchSession(t, answerMatchCatalogFixture{
		version: oldVersion, answer: answer, equivalent: guess, scope: oldScope,
	}, game.AnswerMatchPublicFieldsV1)

	sourceDir := filepath.Join(answerMatchRepositoryRoot(t), "packages", "data", "src")
	hotUpdateDir := writeHotUpdateCatalog(t, sourceDir, answer, guess)
	newVersion, err := seed.Run(ctx, pool, hotUpdateDir)
	if err != nil {
		t.Fatal(err)
	}
	if newVersion == oldVersion {
		t.Fatal("modified seed did not produce a new catalog version")
	}
	t.Cleanup(func() {
		if restoredVersion, restoreErr := seed.Run(ctx, pool, sourceDir); restoreErr != nil {
			t.Errorf("restore source catalog: %v", restoreErr)
		} else if restoredVersion != oldVersion {
			t.Errorf("restored version = %s, want %s", restoredVersion, oldVersion)
		}
	})
	newCharacters := catalogCharactersForVersion(t, newVersion)
	var newAnswer, newGuess game.Character
	for _, character := range newCharacters {
		switch character.ID {
		case answer.ID:
			newAnswer = character
		case guess.ID:
			newGuess = character
		}
	}
	if !game.CharacterFields.Equivalent(newAnswer, newGuess) {
		t.Fatalf("hot-update fixture did not make %s and %s equivalent", answer.ID, guess.ID)
	}

	createResp, createPayload := request(http.MethodPost, "/api/puzzles/random", nil)
	if createResp.StatusCode != http.StatusOK {
		t.Fatalf("new session status %d: %s", createResp.StatusCode, createPayload)
	}
	var created openapi.PuzzleResponse
	if err := json.Unmarshal(createPayload, &created); err != nil {
		t.Fatal(err)
	}
	if created.Session.CatalogVersion == nil || *created.Session.CatalogVersion != newVersion {
		t.Fatalf("new session catalog = %+v, want %s", created.Session.CatalogVersion, newVersion)
	}
	if _, err := pool.Exec(ctx, `UPDATE game_session SET answer_id = $2 WHERE id = $1`, created.Session.Id, answer.ID); err != nil {
		t.Fatal(err)
	}
	newResult := submitSingleGuess(t, created.Session.Id, guess.ID)
	if got := newResult.Guesses[len(newResult.Guesses)-1].MatchKind; got != openapi.MatchKindEquivalent {
		t.Fatalf("new catalog match kind = %s, want equivalent", got)
	}

	oldResult := submitSingleGuess(t, oldSessionID, guess.ID)
	if oldResult.Status != openapi.SessionStatusPlaying || oldResult.Guesses[0].MatchKind != openapi.MatchKindNone {
		t.Fatalf("old session changed after hot seed: %+v", oldResult)
	}
}

func TestSeedRejectsDifferentContentForExistingVersion(t *testing.T) {
	var version string
	var original []byte
	if err := pool.QueryRow(ctx, `
		SELECT state.current_version, snapshot.characters
		FROM catalog_state AS state
		JOIN catalog_snapshot AS snapshot ON snapshot.version = state.current_version
		WHERE state.id = 'current'`).Scan(&version, &original); err != nil {
		t.Fatal(err)
	}
	restored := false
	t.Cleanup(func() {
		if restored {
			return
		}
		if _, err := pool.Exec(ctx, `UPDATE catalog_snapshot SET characters = $2 WHERE version = $1`, version, original); err != nil {
			t.Errorf("restore immutable snapshot fixture: %v", err)
		}
	})
	if _, err := pool.Exec(ctx, `UPDATE catalog_snapshot SET characters = '[]'::jsonb WHERE version = $1`, version); err != nil {
		t.Fatal(err)
	}
	sourceDir := filepath.Join(answerMatchRepositoryRoot(t), "packages", "data", "src")
	if _, err := seed.Run(ctx, pool, sourceDir); err == nil || !strings.Contains(err.Error(), "already exists with different content") {
		t.Fatalf("same-version conflicting seed error = %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE catalog_snapshot SET characters = $2 WHERE version = $1`, version, original); err != nil {
		t.Fatal(err)
	}
	restored = true
	if idempotentVersion, err := seed.Run(ctx, pool, sourceDir); err != nil {
		t.Fatalf("idempotent seed after restore: %v", err)
	} else if idempotentVersion != version {
		t.Fatalf("idempotent seed version = %s, want %s", idempotentVersion, version)
	}
}
