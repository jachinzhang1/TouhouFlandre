package server_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
)

func resolvePuzzle(t *testing.T, mode, key string, body map[string]any) (int, []byte) {
	t.Helper()
	body["idempotencyKey"] = key
	resp, payload := request(http.MethodPost, "/api/puzzles/"+mode+"/resolve", body)
	return resp.StatusCode, payload
}

func decodeResolve(t *testing.T, payload []byte) openapi.PuzzleResolveResponse {
	t.Helper()
	var result openapi.PuzzleResolveResponse
	if err := json.Unmarshal(payload, &result); err != nil {
		t.Fatalf("decode resolve response: %v (%s)", err, payload)
	}
	return result
}

func TestPuzzleResolveRandomRetryConflictAndFinishedResume(t *testing.T) {
	key := fmt.Sprintf("hso005-random-%d", time.Now().UnixNano())
	status, payload := resolvePuzzle(t, "random", key, map[string]any{})
	if status != http.StatusOK {
		t.Fatalf("create status %d: %s", status, payload)
	}
	created := decodeResolve(t, payload)
	if created.Resolution != openapi.Created || created.SupersededSession != nil {
		t.Fatalf("unexpected create response: %+v", created)
	}
	status, payload = resolvePuzzle(t, "random", key+"-playing-resume", map[string]any{"resumeSessionId": created.Session.Id})
	if status != http.StatusOK {
		t.Fatalf("playing resume status %d: %s", status, payload)
	}
	playing := decodeResolve(t, payload)
	if playing.Resolution != openapi.Resumed || playing.Session.Id != created.Session.Id || playing.Session.Status != openapi.SessionStatusPlaying {
		t.Fatalf("playing random was not resumed: %+v", playing)
	}

	status, payload = resolvePuzzle(t, "random", key, map[string]any{})
	if status != http.StatusOK {
		t.Fatalf("retry status %d: %s", status, payload)
	}
	retried := decodeResolve(t, payload)
	if retried.Session.Id != created.Session.Id || retried.Resolution != openapi.Created {
		t.Fatalf("retry did not return first binding: %+v vs %+v", retried, created)
	}

	status, payload = resolvePuzzle(t, "random", key, map[string]any{"resumeSessionId": created.Session.Id})
	if status != http.StatusConflict {
		t.Fatalf("fingerprint conflict status %d: %s", status, payload)
	}
	if apiErr := decodeError(t, payload); apiErr.Code != openapi.ErrorResponseCodeIDEMPOTENCYKEYREUSED {
		t.Fatalf("unexpected conflict: %+v", apiErr)
	}

	if _, err := pool.Exec(ctx, `UPDATE game_session SET status = 'lost', ended_at = now() WHERE id = $1`, created.Session.Id); err != nil {
		t.Fatal(err)
	}
	resumeKey := key + "-resume"
	status, payload = resolvePuzzle(t, "random", resumeKey, map[string]any{"resumeSessionId": created.Session.Id})
	if status != http.StatusOK {
		t.Fatalf("finished resume status %d: %s", status, payload)
	}
	resumed := decodeResolve(t, payload)
	if resumed.Resolution != openapi.Resumed || resumed.Session.Id != created.Session.Id || resumed.Session.Status != openapi.SessionStatusLost {
		t.Fatalf("finished random was not resumed: %+v", resumed)
	}
}

func TestPuzzleResolveDailyDifficultiesAndMismatch(t *testing.T) {
	difficulties := []string{"easy", "normal", "hard", "lunatic"}
	var normal openapi.PuzzleResolveResponse
	for _, difficulty := range difficulties {
		key := fmt.Sprintf("hso005-daily-%s-%d", difficulty, time.Now().UnixNano())
		status, payload := resolvePuzzle(t, "daily", key, map[string]any{"difficulty": difficulty})
		if status != http.StatusOK {
			t.Fatalf("%s create status %d: %s", difficulty, status, payload)
		}
		created := decodeResolve(t, payload)
		if created.Resolution != openapi.Created || created.Session.QuestionScope == nil || string(created.Session.QuestionScope.Difficulty) != difficulty {
			t.Fatalf("unexpected %s create: %+v", difficulty, created)
		}
		if difficulty == "normal" {
			if _, err := pool.Exec(ctx, `UPDATE game_session SET status = 'lost', ended_at = now() WHERE id = $1`, created.Session.Id); err != nil {
				t.Fatal(err)
			}
		}
		resumeKey := key + "-resume"
		status, payload = resolvePuzzle(t, "daily", resumeKey, map[string]any{
			"difficulty": difficulty, "resumeSessionId": created.Session.Id,
		})
		if status != http.StatusOK {
			t.Fatalf("%s resume status %d: %s", difficulty, status, payload)
		}
		resumed := decodeResolve(t, payload)
		if resumed.Resolution != openapi.Resumed || resumed.Session.Id != created.Session.Id {
			t.Fatalf("unexpected %s resume: %+v", difficulty, resumed)
		}
		if difficulty == "normal" {
			if resumed.Session.Status != openapi.SessionStatusLost {
				t.Fatalf("finished daily did not retain status: %+v", resumed)
			}
			normal = created
		}
	}

	status, payload := resolvePuzzle(t, "daily", "hso005-difficulty-mismatch", map[string]any{
		"difficulty": "hard", "resumeSessionId": normal.Session.Id,
	})
	if status != http.StatusOK {
		t.Fatalf("difficulty mismatch status %d: %s", status, payload)
	}
	mismatch := decodeResolve(t, payload)
	if mismatch.Resolution != openapi.Created || mismatch.Session.Id == normal.Session.Id || mismatch.SupersededSession == nil || mismatch.SupersededSession.Id != normal.Session.Id {
		t.Fatalf("difficulty mismatch did not supersede: %+v", mismatch)
	}

	status, payload = resolvePuzzle(t, "daily", "hso005-mode-mismatch", map[string]any{
		"difficulty": "normal", "resumeSessionId": mismatch.Session.Id,
	})
	if status != http.StatusOK {
		t.Fatalf("daily same-mode status %d: %s", status, payload)
	}

	randomStatus, randomPayload := resolvePuzzle(t, "random", "hso005-mode-source", map[string]any{})
	if randomStatus != http.StatusOK {
		t.Fatalf("random source status %d: %s", randomStatus, randomPayload)
	}
	random := decodeResolve(t, randomPayload)
	status, payload = resolvePuzzle(t, "daily", "hso005-mode-mismatch-target", map[string]any{
		"difficulty": "normal", "resumeSessionId": random.Session.Id,
	})
	if status != http.StatusOK {
		t.Fatalf("mode mismatch status %d: %s", status, payload)
	}
	modeMismatch := decodeResolve(t, payload)
	if modeMismatch.Resolution != openapi.Created || modeMismatch.SupersededSession == nil || modeMismatch.SupersededSession.Id != random.Session.Id {
		t.Fatalf("mode mismatch did not supersede: %+v", modeMismatch)
	}
}

func TestPuzzleResolveMissingAndExpiredDailySessionCreate(t *testing.T) {
	status, payload := resolvePuzzle(t, "random", "hso005-missing", map[string]any{"resumeSessionId": "missing-hso005"})
	if status != http.StatusOK {
		t.Fatalf("missing status %d: %s", status, payload)
	}
	missing := decodeResolve(t, payload)
	if missing.Resolution != openapi.Created || missing.SupersededSession != nil {
		t.Fatalf("missing session result: %+v", missing)
	}

	status, payload = resolvePuzzle(t, "daily", "hso005-expired-source", map[string]any{"difficulty": "easy"})
	if status != http.StatusOK {
		t.Fatalf("daily source status %d: %s", status, payload)
	}
	source := decodeResolve(t, payload)
	if _, err := pool.Exec(ctx, `UPDATE game_session SET puzzle_key = '2000-01-01' WHERE id = $1`, source.Session.Id); err != nil {
		t.Fatal(err)
	}
	status, payload = resolvePuzzle(t, "daily", "hso005-expired-target", map[string]any{
		"difficulty": "easy", "resumeSessionId": source.Session.Id,
	})
	if status != http.StatusOK {
		t.Fatalf("expired daily status %d: %s", status, payload)
	}
	expired := decodeResolve(t, payload)
	if expired.Resolution != openapi.Created || expired.SupersededSession == nil || expired.SupersededSession.Id != source.Session.Id {
		t.Fatalf("expired daily did not supersede: %+v", expired)
	}
}

func TestPuzzleResolveConcurrentSameKeyCreatesOnce(t *testing.T) {
	key := fmt.Sprintf("hso005-concurrent-%d", time.Now().UnixNano())
	const count = 12
	type result struct {
		status  int
		payload []byte
	}
	results := make(chan result, count)
	var wait sync.WaitGroup
	for range count {
		wait.Add(1)
		go func() {
			defer wait.Done()
			status, payload := resolvePuzzle(t, "random", key, map[string]any{})
			results <- result{status: status, payload: payload}
		}()
	}
	wait.Wait()
	close(results)
	var sessionID string
	for item := range results {
		if item.status != http.StatusOK {
			t.Fatalf("concurrent status %d: %s", item.status, item.payload)
		}
		resolved := decodeResolve(t, item.payload)
		if sessionID == "" {
			sessionID = resolved.Session.Id
		}
		if resolved.Session.Id != sessionID || resolved.Resolution != openapi.Created {
			t.Fatalf("concurrent binding diverged: %+v", resolved)
		}
	}
	var sessions int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM game_session WHERE id = $1`, sessionID).Scan(&sessions); err != nil {
		t.Fatal(err)
	}
	if sessions != 1 {
		t.Fatalf("created session count = %d, want 1", sessions)
	}
}

func TestPuzzleResolveExpiredIdempotencyKeyMayBeReused(t *testing.T) {
	key := fmt.Sprintf("hso005-reuse-%d", time.Now().UnixNano())
	status, payload := resolvePuzzle(t, "random", key, map[string]any{})
	if status != http.StatusOK {
		t.Fatalf("first status %d: %s", status, payload)
	}
	first := decodeResolve(t, payload)
	if _, err := pool.Exec(ctx, `UPDATE puzzle_resolve_idempotency SET expires_at = now() - interval '1 second' WHERE idempotency_key = $1`, key); err != nil {
		t.Fatal(err)
	}
	status, payload = resolvePuzzle(t, "daily", key, map[string]any{"difficulty": "lunatic"})
	if status != http.StatusOK {
		t.Fatalf("reuse status %d: %s", status, payload)
	}
	reused := decodeResolve(t, payload)
	if reused.Resolution != openapi.Created || reused.Session.Id == first.Session.Id || reused.Session.Mode != openapi.GameModeDaily {
		t.Fatalf("expired key was not reused: %+v", reused)
	}
}
