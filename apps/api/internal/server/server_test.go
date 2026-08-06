package server_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/handler"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/hub"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/seed"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/server"
)

var (
	client  *http.Client
	baseURL string
	pool    *pgxpool.Pool
	ctx     = context.Background()

	fastBaseURL string
	fastClient  *http.Client
	fastTiming  multi.TimingConfig
	fastHub     *hub.Hub
)

const testDBName = "touhouflandre_test"

// replaceDBName 只替换连接串路径中的数据库名（user 字段也可能含同名子串）。
func replaceDBName(connectionURL, newDB string) string {
	idx := strings.LastIndex(connectionURL, "/touhouflandre")
	if idx < 0 {
		return connectionURL
	}
	return connectionURL[:idx+1] + newDB
}

func loadEnv(path string) map[string]string {
	env := map[string]string{}
	data, err := os.ReadFile(path)
	if err != nil {
		return env
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		env[strings.TrimSpace(key)] = strings.Trim(strings.TrimSpace(value), `"'`)
	}
	return env
}

func TestMain(m *testing.M) {
	_, filename, _, _ := runtime.Caller(0)
	repoRoot := filepath.Join(filepath.Dir(filename), "..", "..", "..", "..")
	migrationsDir := filepath.Join(repoRoot, "apps", "api", "migrations")

	baseURLPg := os.Getenv("DATABASE_URL_PG")
	if baseURLPg == "" {
		env := loadEnv(filepath.Join(repoRoot, ".env"))
		baseURLPg = env["DATABASE_URL_PG"]
	}
	if baseURLPg == "" {
		fmt.Fprintln(os.Stderr, "integration test requires DATABASE_URL_PG env or .env")
		os.Exit(1)
	}
	adminURL := replaceDBName(baseURLPg, "postgres")
	testURL := replaceDBName(baseURLPg, testDBName)

	var err error
	// 用 admin（postgres 库）连接重建测试库。
	adminPool, err := pgxpool.New(ctx, adminURL)
	if err != nil {
		fmt.Fprintln(os.Stderr, "connect admin db:", err)
		os.Exit(1)
	}
	if _, err := adminPool.Exec(ctx, "DROP DATABASE IF EXISTS "+testDBName+" WITH (FORCE)"); err != nil {
		fmt.Fprintln(os.Stderr, "drop test db:", err)
		os.Exit(1)
	}
	if _, err := adminPool.Exec(ctx, "CREATE DATABASE "+testDBName); err != nil {
		fmt.Fprintln(os.Stderr, "create test db:", err)
		os.Exit(1)
	}
	adminPool.Close()

	pool, err = pgxpool.New(ctx, testURL)
	if err != nil {
		fmt.Fprintln(os.Stderr, "connect test db:", err)
		os.Exit(1)
	}

	// goose 迁移 + seed。
	sqlDB, err := sql.Open("pgx", testURL)
	if err != nil {
		fmt.Fprintln(os.Stderr, "open sql db:", err)
		os.Exit(1)
	}
	if err := goose.SetDialect("postgres"); err != nil {
		fmt.Fprintln(os.Stderr, "goose dialect:", err)
		os.Exit(1)
	}
	if err := goose.Up(sqlDB, migrationsDir); err != nil {
		fmt.Fprintln(os.Stderr, "goose up:", err)
		os.Exit(1)
	}
	if err := sqlDB.Close(); err != nil {
		fmt.Fprintln(os.Stderr, "close sql db:", err)
		os.Exit(1)
	}
	version, err := seed.Run(ctx, pool, filepath.Join(repoRoot, "packages", "data", "src"))
	if err != nil {
		fmt.Fprintln(os.Stderr, "seed:", err)
		os.Exit(1)
	}
	fmt.Printf("integration: seeded catalog %s\n", version)

	ts := httptest.NewServer(server.NewWithOptions(pool, handler.WithJoinRateLimit(10000, time.Minute)))
	baseURL = ts.URL
	client = ts.Client()

	// 对局引擎测试专用：短时间常量 + 独立进程内限流器（sweeper 由测试手动驱动）。
	fastTiming = multi.TimingConfig{
		RoundCountdown:    5 * time.Millisecond,
		Intermission:      5 * time.Millisecond,
		RoundSeconds:      30 * time.Second,
		DisconnectGrace:   1 * time.Second,
		MaxRoundsFactor:   3,
		FinishedRetention: time.Hour,
	}
	fastHub = hub.New(pool, fastTiming.DisconnectGrace)
	fastTS := httptest.NewServer(server.NewWithOptions(pool,
		handler.WithJoinRateLimit(10000, time.Minute),
		handler.WithMultiTiming(fastTiming),
		handler.WithHub(fastHub)))
	fastBaseURL = fastTS.URL
	fastClient = fastTS.Client()

	code := m.Run()

	ts.Close()
	fastTS.Close()
	pool.Close()
	os.Exit(code)
}

func request(method, path string, body any) (*http.Response, []byte) {
	var reader io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, baseURL+path, reader)
	if err != nil {
		panic(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := client.Do(req)
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()
	payload, _ := io.ReadAll(resp.Body)
	return resp, payload
}

func decodeError(t *testing.T, payload []byte) openapi.ErrorResponse {
	t.Helper()
	var apiErr openapi.ErrorResponse
	if err := json.Unmarshal(payload, &apiErr); err != nil {
		t.Fatalf("error response is not ErrorResponse: %v (%s)", err, payload)
	}
	return apiErr
}

func TestHealth(t *testing.T) {
	resp, payload := request(http.MethodGet, "/api/health", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d: %s", resp.StatusCode, payload)
	}
	var health struct {
		Ok      bool   `json:"ok"`
		Service string `json:"service"`
	}
	if err := json.Unmarshal(payload, &health); err != nil || !health.Ok {
		t.Fatalf("unexpected health body: %s", payload)
	}
}

func TestReadyzSkipsOpenAPIValidation(t *testing.T) {
	resp, payload := request(http.MethodGet, "/readyz", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("readyz status %d: %s", resp.StatusCode, payload)
	}
}

func TestCatalog(t *testing.T) {
	resp, payload := request(http.MethodGet, "/api/catalog", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d: %s", resp.StatusCode, payload)
	}
	var summary openapi.CatalogSummary
	if err := json.Unmarshal(payload, &summary); err != nil {
		t.Fatal(err)
	}
	if len(summary.Contents) != 1 {
		t.Fatalf("expected 1 content, got %d", len(summary.Contents))
	}
	content := summary.Contents[0]
	// 计数随题库扩展（TH06–TH20 共 113 角色）；08 设计文档 §4.2 亦以 113 为基线。
	if content.Total != 113 || content.Guessable != 113 || content.Answerable != 113 {
		t.Fatalf("unexpected counts: %+v", content)
	}
	if content.MaxGuesses != 8 || content.VisibleFieldCount != 6 {
		t.Fatalf("unexpected definition: %+v", content)
	}
}

func TestSearchReimu(t *testing.T) {
	resp, payload := request(http.MethodGet, "/api/characters/search?q=%E7%81%B5%E6%A2%A6", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d: %s", resp.StatusCode, payload)
	}
	var search openapi.CharacterSearchResponse
	if err := json.Unmarshal(payload, &search); err != nil {
		t.Fatal(err)
	}
	if search.Total != 1 || len(search.Results) != 1 {
		t.Fatalf("expected 1 result, got %+v", search)
	}
	if search.Results[0].Id != "reimu_hakurei" {
		t.Fatalf("unexpected result: %+v", search.Results[0])
	}
}

func TestSearchRejectsInvalidSort(t *testing.T) {
	resp, payload := request(http.MethodGet, "/api/characters/search?sort=bad", nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status %d: %s", resp.StatusCode, payload)
	}
	if apiErr := decodeError(t, payload); apiErr.Code != "INVALID_REQUEST" {
		t.Fatalf("unexpected error: %+v", apiErr)
	}
}

func TestDailyPuzzleIsStablePerDate(t *testing.T) {
	firstResp, firstPayload := request(http.MethodPost, "/api/puzzles/daily", nil)
	if firstResp.StatusCode != http.StatusOK {
		t.Fatalf("status %d: %s", firstResp.StatusCode, firstPayload)
	}
	var first openapi.PuzzleResponse
	if err := json.Unmarshal(firstPayload, &first); err != nil {
		t.Fatal(err)
	}
	if first.PuzzleLabel == "" || first.Session.PuzzleKey == nil {
		t.Fatalf("missing label/key: %+v", first)
	}

	_, secondPayload := request(http.MethodPost, "/api/puzzles/daily", nil)
	var second openapi.PuzzleResponse
	if err := json.Unmarshal(secondPayload, &second); err != nil {
		t.Fatal(err)
	}
	if *second.Session.PuzzleKey != *first.Session.PuzzleKey {
		t.Fatalf("daily key changed: %q vs %q", *first.Session.PuzzleKey, *second.Session.PuzzleKey)
	}
}

func TestGuessLifecycle(t *testing.T) {
	_, createPayload := request(http.MethodPost, "/api/puzzles/random", nil)
	var created openapi.PuzzleResponse
	if err := json.Unmarshal(createPayload, &created); err != nil {
		t.Fatal(err)
	}
	sessionID := created.Session.Id

	// 从当前会话取答案，使猜测可预知。
	var answerID string
	if err := pool.QueryRow(ctx,
		`SELECT answer_id FROM game_session WHERE id = $1`, sessionID,
	).Scan(&answerID); err != nil {
		t.Fatal(err)
	}

	// 错误猜测（排除答案角色，避免随机题答案恰好命中）：保持 playing。
	var missGuessID string
	if err := pool.QueryRow(ctx,
		`SELECT id FROM character WHERE enabled_as_guess = true AND id <> $1 ORDER BY id LIMIT 1`, answerID,
	).Scan(&missGuessID); err != nil {
		t.Fatal(err)
	}
	miss, missPayload := request(http.MethodPost, "/api/sessions/"+sessionID+"/guess",
		map[string]string{"guessId": missGuessID})
	if miss.StatusCode != http.StatusOK {
		t.Fatalf("miss guess status %d: %s", miss.StatusCode, missPayload)
	}
	var missWrapper struct {
		Session openapi.PublicGameSession `json:"session"`
	}
	if err := json.Unmarshal(missPayload, &missWrapper); err != nil {
		t.Fatal(err)
	}
	afterMiss := missWrapper.Session
	if afterMiss.Status != "playing" || len(afterMiss.Guesses) != 1 {
		t.Fatalf("unexpected after miss: %+v", afterMiss)
	}
	if afterMiss.Guesses[0].GuessId != missGuessID {
		t.Fatalf("unexpected guess id: %+v", afterMiss.Guesses[0])
	}
	if afterMiss.Guesses[0].GuessAvatarUrl == nil {
		t.Fatal("avatar hydration failed")
	}

	// 正确猜测：结束并返回答案。
	hit, hitPayload := request(http.MethodPost, "/api/sessions/"+sessionID+"/guess",
		map[string]string{"guessId": answerID})
	if hit.StatusCode != http.StatusOK {
		t.Fatalf("hit guess status %d: %s", hit.StatusCode, hitPayload)
	}
	var hitWrapper struct {
		Session openapi.PublicGameSession `json:"session"`
	}
	if err := json.Unmarshal(hitPayload, &hitWrapper); err != nil {
		t.Fatal(err)
	}
	won := hitWrapper.Session
	if won.Status != "won" || won.Answer == nil || won.Answer.Id != answerID {
		t.Fatalf("unexpected won state: %+v", won)
	}
	if won.EndedAt == nil {
		t.Fatal("endedAt missing after win")
	}

	// 已结束会话再猜：409 SESSION_CLOSED。
	closed, closedPayload := request(http.MethodPost, "/api/sessions/"+sessionID+"/guess",
		map[string]string{"guessId": "cirno"})
	if closed.StatusCode != http.StatusConflict {
		t.Fatalf("closed status %d: %s", closed.StatusCode, closedPayload)
	}
	if apiErr := decodeError(t, closedPayload); apiErr.Code != "SESSION_CLOSED" {
		t.Fatalf("unexpected error: %+v", apiErr)
	}
}

func TestDuplicateGuessConflict(t *testing.T) {
	_, createPayload := request(http.MethodPost, "/api/puzzles/random", nil)
	var created openapi.PuzzleResponse
	if err := json.Unmarshal(createPayload, &created); err != nil {
		t.Fatal(err)
	}
	sessionID := created.Session.Id

	// 选一个不是答案的角色，保证重复猜测走到 DUPLICATE_GUESS 分支。
	var answerID string
	if err := pool.QueryRow(ctx,
		`SELECT answer_id FROM game_session WHERE id = $1`, sessionID,
	).Scan(&answerID); err != nil {
		t.Fatal(err)
	}
	var guessID string
	if err := pool.QueryRow(ctx,
		`SELECT id FROM character WHERE enabled_as_guess AND id <> $1 ORDER BY id LIMIT 1`, answerID,
	).Scan(&guessID); err != nil {
		t.Fatal(err)
	}

	first, _ := request(http.MethodPost, "/api/sessions/"+sessionID+"/guess",
		map[string]string{"guessId": guessID})
	if first.StatusCode != http.StatusOK {
		t.Fatalf("first guess status %d", first.StatusCode)
	}
	dup, dupPayload := request(http.MethodPost, "/api/sessions/"+sessionID+"/guess",
		map[string]string{"guessId": guessID})
	if dup.StatusCode != http.StatusConflict {
		t.Fatalf("duplicate status %d: %s", dup.StatusCode, dupPayload)
	}
	if apiErr := decodeError(t, dupPayload); apiErr.Code != "DUPLICATE_GUESS" {
		t.Fatalf("unexpected error: %+v", apiErr)
	}
}

func TestSessionNotFound(t *testing.T) {
	resp, payload := request(http.MethodGet, "/api/sessions/missing", nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status %d: %s", resp.StatusCode, payload)
	}
	if apiErr := decodeError(t, payload); apiErr.Code != "SESSION_NOT_FOUND" {
		t.Fatalf("unexpected error: %+v", apiErr)
	}
}

// TestConcurrentGuesses 验证乐观锁：并发提交两个不同猜测，
// 两次合法猜测都成功（重试机制），且最终无丢失更新（version 递增、两个猜测都在）。
func TestConcurrentGuesses(t *testing.T) {
	_, createPayload := request(http.MethodPost, "/api/puzzles/random", nil)
	var created openapi.PuzzleResponse
	if err := json.Unmarshal(createPayload, &created); err != nil {
		t.Fatal(err)
	}
	sessionID := created.Session.Id

	// 选两个不是答案的可猜角色，避免猜中后会话提前结束。
	var answerID string
	if err := pool.QueryRow(ctx,
		`SELECT answer_id FROM game_session WHERE id = $1`, sessionID,
	).Scan(&answerID); err != nil {
		t.Fatal(err)
	}
	rows, err := pool.Query(ctx,
		`SELECT id FROM character WHERE enabled_as_guess AND id <> $1 ORDER BY id LIMIT 2`, answerID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var guessIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		guessIDs = append(guessIDs, id)
	}
	if len(guessIDs) != 2 {
		t.Fatal("need at least 2 guessable characters")
	}

	var wg sync.WaitGroup
	statuses := make([]int, len(guessIDs))
	for i, guessID := range guessIDs {
		wg.Add(1)
		go func(index int, id string) {
			defer wg.Done()
			resp, _ := request(http.MethodPost, "/api/sessions/"+sessionID+"/guess",
				map[string]string{"guessId": id})
			statuses[index] = resp.StatusCode
		}(i, guessID)
	}
	wg.Wait()

	for i, status := range statuses {
		if status != http.StatusOK {
			t.Fatalf("guess %q failed with %d", guessIDs[i], status)
		}
	}

	// 两个猜测都必须被记录（乐观锁防覆盖）。
	resp, payload := request(http.MethodGet, "/api/sessions/"+sessionID, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get session %d: %s", resp.StatusCode, payload)
	}
	var wrapper struct {
		Session openapi.PublicGameSession `json:"session"`
	}
	if err := json.Unmarshal(payload, &wrapper); err != nil {
		t.Fatal(err)
	}
	session := wrapper.Session
	if len(session.Guesses) != 2 {
		t.Fatalf("expected 2 recorded guesses, got %d", len(session.Guesses))
	}
	recorded := map[string]bool{}
	for _, guess := range session.Guesses {
		recorded[guess.GuessId] = true
	}
	for _, guessID := range guessIDs {
		if !recorded[guessID] {
			t.Fatalf("guess %q lost in concurrent update", guessID)
		}
	}
}
