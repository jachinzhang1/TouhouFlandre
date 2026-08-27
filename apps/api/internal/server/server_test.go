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
	"net/url"
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

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
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

	poolConfig, err := pgxpool.ParseConfig(testURL)
	if err != nil {
		fmt.Fprintln(os.Stderr, "parse test db config:", err)
		os.Exit(1)
	}
	poolConfig.MaxConns = 4
	pool, err = pgxpool.NewWithConfig(ctx, poolConfig)
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

	enabledRollout := handler.RolloutConfig{
		NPlayerRaceEnabled: true, NPlayerRelayEnabled: true, RelayEliminationEnabled: true,
		ChatSendEnabled: true, SystemAnnouncementsEnabled: true,
	}
	ts := httptest.NewServer(server.NewWithOptions(pool,
		handler.WithAnswerMatchPolicy(game.AnswerMatchPublicFieldsV1),
		handler.WithJoinRateLimit(10000, time.Minute),
		handler.WithCharacterSearchConfig(handler.CharacterSearchConfig{QuestionScopeFilterEnabled: true}),
		handler.WithRolloutConfig(enabledRollout)))
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
	fastHub = hub.New(pool, fastTiming.DisconnectGrace, 4096, 64, []byte("integration-test-projection-secret"), 24*time.Hour, []byte("integration-test-chat-cursor-secret"))
	fastTS := httptest.NewServer(server.NewWithOptions(pool,
		handler.WithAnswerMatchPolicy(game.AnswerMatchPublicFieldsV1),
		handler.WithJoinRateLimit(10000, time.Minute),
		handler.WithCharacterSearchConfig(handler.CharacterSearchConfig{QuestionScopeFilterEnabled: true}),
		handler.WithMultiTiming(fastTiming),
		handler.WithChatConfig(24*time.Hour, multi.DefaultChatRateConfig(), []byte("integration-test-chat-cursor-secret")),
		handler.WithRolloutConfig(enabledRollout),
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

func TestSiteVisitsCreateIncrementsCount(t *testing.T) {
	initial := currentVisitCount(t)

	firstResp, firstPayload := request(http.MethodPost, "/api/site/visits", nil)
	if firstResp.StatusCode != http.StatusOK {
		t.Fatalf("first visit status %d: %s", firstResp.StatusCode, firstPayload)
	}
	var first openapi.SiteVisitResponse
	if err := json.Unmarshal(firstPayload, &first); err != nil {
		t.Fatal(err)
	}
	if first.Count != initial+1 {
		t.Fatalf("first count %d, want %d", first.Count, initial+1)
	}

	secondResp, secondPayload := request(http.MethodPost, "/api/site/visits", nil)
	if secondResp.StatusCode != http.StatusOK {
		t.Fatalf("second visit status %d: %s", secondResp.StatusCode, secondPayload)
	}
	var second openapi.SiteVisitResponse
	if err := json.Unmarshal(secondPayload, &second); err != nil {
		t.Fatal(err)
	}
	if second.Count != initial+2 {
		t.Fatalf("second count %d, want %d", second.Count, initial+2)
	}
	if stored := currentVisitCount(t); stored != initial+2 {
		t.Fatalf("stored count %d, want %d", stored, initial+2)
	}
}

func TestSiteVisitsCreateIsAtomic(t *testing.T) {
	initial := currentVisitCount(t)
	const requests = 16

	var wg sync.WaitGroup
	statuses := make([]int, requests)
	for i := range statuses {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			resp, _ := request(http.MethodPost, "/api/site/visits", nil)
			statuses[index] = resp.StatusCode
		}(i)
	}
	wg.Wait()

	for i, status := range statuses {
		if status != http.StatusOK {
			t.Fatalf("request %d status %d", i, status)
		}
	}
	if stored := currentVisitCount(t); stored != initial+requests {
		t.Fatalf("stored count %d, want %d", stored, initial+requests)
	}
}

func currentVisitCount(t *testing.T) int64 {
	t.Helper()
	var count int64
	if err := pool.QueryRow(ctx,
		`SELECT value FROM site_metric WHERE key = 'visits_total'`,
	).Scan(&count); err != nil {
		t.Fatalf("query visit count: %v", err)
	}
	return count
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
	var dbTotal, dbGuessable, dbAnswerable int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM character`).Scan(&dbTotal); err != nil {
		t.Fatalf("query db total: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM character WHERE enabled_as_guess`).Scan(&dbGuessable); err != nil {
		t.Fatalf("query db guessable: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM character WHERE enabled_as_answer`).Scan(&dbAnswerable); err != nil {
		t.Fatalf("query db answerable: %v", err)
	}
	if content.Total != dbTotal || content.Guessable != dbGuessable || content.Answerable != dbAnswerable {
		t.Fatalf(
			"unexpected counts: %+v (db: total=%d guessable=%d answerable=%d)",
			content,
			dbTotal,
			dbGuessable,
			dbAnswerable,
		)
	}
	if content.MaxGuesses != 8 || content.VisibleFieldCount != 6 {
		t.Fatalf("unexpected definition: %+v", content)
	}
	if len(summary.Works) == 0 {
		t.Fatalf("expected works in catalog summary: %+v", summary)
	}
	if summary.Works[0].ReleaseYear > summary.Works[len(summary.Works)-1].ReleaseYear {
		t.Fatalf("works are not ordered by release year: %+v", summary.Works[:2])
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
	if !searchContainsCharacter(search, "reimu_hakurei") {
		t.Fatalf("expected Reimu in results, got %+v", search)
	}
}

func searchContainsCharacter(search openapi.CharacterSearchResponse, characterID string) bool {
	for _, result := range search.Results {
		if result.Id == characterID {
			return true
		}
	}
	return false
}

func TestSearchByWorkPinyinInitialsAndFieldBoundary(t *testing.T) {
	for _, query := range []string{"hmx", "dfhmx"} {
		resp, payload := request(http.MethodGet, "/api/characters/search?q="+query+"&sort=appearance", nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("%s status %d: %s", query, resp.StatusCode, payload)
		}
		var search openapi.CharacterSearchResponse
		if err := json.Unmarshal(payload, &search); err != nil {
			t.Fatal(err)
		}
		if search.Total != 9 || len(search.Results) != 9 {
			t.Fatalf("%s should return the 9 EoSD characters, got %+v", query, search)
		}
		for _, result := range search.Results {
			if result.WorkId != "th06_eosd" {
				t.Fatalf("%s returned a character from %s: %+v", query, result.WorkId, result)
			}
		}
	}

	resp, payload := request(http.MethodGet, "/api/characters/search?q=%E6%A2%A6%E4%B8%9C", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("boundary status %d: %s", resp.StatusCode, payload)
	}
	var boundary openapi.CharacterSearchResponse
	if err := json.Unmarshal(payload, &boundary); err != nil {
		t.Fatal(err)
	}
	if boundary.Total != 0 {
		t.Fatalf("query must not match across name/work boundaries: %+v", boundary)
	}
}

func TestSearchCatalogVersionAndScopeValidation(t *testing.T) {
	var version string
	if err := pool.QueryRow(ctx, `SELECT current_version FROM catalog_state WHERE id = 'current'`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	resp, payload := request(http.MethodGet, "/api/characters/search?q=hmx&catalogVersion="+version, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("version search status %d: %s", resp.StatusCode, payload)
	}
	var search openapi.CharacterSearchResponse
	if err := json.Unmarshal(payload, &search); err != nil {
		t.Fatal(err)
	}
	if search.Total != 9 {
		t.Fatalf("version-bound search differs from current catalog: %+v", search)
	}

	conflictResp, conflictPayload := request(
		http.MethodGet,
		"/api/characters/search?sessionId=one&catalogVersion="+version,
		nil,
	)
	if conflictResp.StatusCode != http.StatusBadRequest {
		t.Fatalf("scope conflict status %d: %s", conflictResp.StatusCode, conflictPayload)
	}
	if apiErr := decodeError(t, conflictPayload); apiErr.Code != "INVALID_REQUEST" {
		t.Fatalf("unexpected conflict error: %+v", apiErr)
	}

	missingResp, missingPayload := request(http.MethodGet, "/api/characters/search?catalogVersion=missing", nil)
	if missingResp.StatusCode != http.StatusNotFound {
		t.Fatalf("missing version status %d: %s", missingResp.StatusCode, missingPayload)
	}
	if apiErr := decodeError(t, missingPayload); apiErr.Code != "CATALOG_VERSION_NOT_FOUND" {
		t.Fatalf("unexpected missing version error: %+v", apiErr)
	}

	invalidPaths := []string{
		"/api/characters/search?roomId=room-only",
		"/api/characters/search?matchIndex=0",
		"/api/characters/search?roomId=room-1&matchIndex=0&sessionId=session-1",
		"/api/characters/search?roomId=room-1&matchIndex=0&catalogVersion=" + version,
	}
	for _, path := range invalidPaths {
		invalidResp, invalidPayload := request(http.MethodGet, path, nil)
		if invalidResp.StatusCode != http.StatusBadRequest {
			t.Fatalf("invalid context %s status %d: %s", path, invalidResp.StatusCode, invalidPayload)
		}
		if apiErr := decodeError(t, invalidPayload); apiErr.Code != "INVALID_REQUEST" {
			t.Fatalf("invalid context %s error: %+v", path, apiErr)
		}
	}

	missingMatchResp, missingMatchPayload := request(
		http.MethodGet,
		"/api/characters/search?roomId=missing&matchIndex=0",
		nil,
	)
	if missingMatchResp.StatusCode != http.StatusNotFound {
		t.Fatalf("missing match status %d: %s", missingMatchResp.StatusCode, missingMatchPayload)
	}
	if apiErr := decodeError(t, missingMatchPayload); apiErr.Code != "ROOM_NOT_FOUND" {
		t.Fatalf("unexpected missing match error: %+v", apiErr)
	}
}

func catalogCharactersForVersion(t *testing.T, version string) []game.Character {
	t.Helper()
	var raw []byte
	if err := pool.QueryRow(ctx, `SELECT characters FROM catalog_snapshot WHERE version = $1`, version).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var characters []game.Character
	if err := json.Unmarshal(raw, &characters); err != nil {
		t.Fatal(err)
	}
	return characters
}

func expectedQuestionScopeSearchIDs(characters []game.Character, selectedIDs []string) map[string]bool {
	selected := make(map[string]bool, len(selectedIDs))
	for _, characterID := range selectedIDs {
		selected[characterID] = true
	}
	expected := map[string]bool{}
	for _, character := range characters {
		if character.EnabledAsGuess && selected[character.ID] {
			expected[character.ID] = true
		}
	}
	return expected
}

func assertSearchResultIDs(t *testing.T, payload []byte, expected map[string]bool) {
	t.Helper()
	var search openapi.CharacterSearchResponse
	if err := json.Unmarshal(payload, &search); err != nil {
		t.Fatal(err)
	}
	if search.Total != len(expected) || len(search.Results) != len(expected) {
		t.Fatalf("search result count = %d/%d, want %d: %+v", search.Total, len(search.Results), len(expected), search)
	}
	for _, result := range search.Results {
		if !expected[result.Id] {
			t.Fatalf("search returned out-of-scope character %s", result.Id)
		}
		delete(expected, result.Id)
	}
	if len(expected) != 0 {
		t.Fatalf("search omitted in-scope characters: %+v", expected)
	}
}

func outOfScopeGuessableCharacter(t *testing.T, characters []game.Character, selectedIDs []string) game.Character {
	t.Helper()
	selected := make(map[string]bool, len(selectedIDs))
	for _, characterID := range selectedIDs {
		selected[characterID] = true
	}
	for _, character := range characters {
		if character.EnabledAsGuess && !selected[character.ID] {
			return character
		}
	}
	t.Fatal("test catalog has no guessable character outside the selected question scope")
	return game.Character{}
}

func TestSinglePlayerSearchUsesFrozenQuestionScope(t *testing.T) {
	for _, mode := range []string{"daily", "random"} {
		t.Run(mode, func(t *testing.T) {
			resp, payload := request(http.MethodPost, "/api/puzzles/"+mode, nil)
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("create %s status %d: %s", mode, resp.StatusCode, payload)
			}
			var created openapi.PuzzleResponse
			if err := json.Unmarshal(payload, &created); err != nil {
				t.Fatal(err)
			}
			if created.Session.QuestionScope == nil || created.Session.CatalogVersion == nil {
				t.Fatalf("created %s session lacks frozen search context: %+v", mode, created.Session)
			}
			characters := catalogCharactersForVersion(t, *created.Session.CatalogVersion)
			expected := expectedQuestionScopeSearchIDs(characters, created.Session.QuestionScope.SelectedCharacterIds)
			searchResp, searchPayload := request(
				http.MethodGet,
				"/api/characters/search?limit=250&sessionId="+url.QueryEscape(created.Session.Id),
				nil,
			)
			if searchResp.StatusCode != http.StatusOK {
				t.Fatalf("%s scoped search status %d: %s", mode, searchResp.StatusCode, searchPayload)
			}
			assertSearchResultIDs(t, searchPayload, expected)
		})
	}
}

func TestLegacyQuestionScopeRequestsNormalizeToV3(t *testing.T) {
	var version string
	if err := pool.QueryRow(ctx, `SELECT current_version FROM catalog_state WHERE id = 'current'`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	characters := catalogCharactersForVersion(t, version)
	selectedIDs := make([]string, 0, len(characters))
	for _, character := range characters {
		if character.EnabledAsAnswer {
			selectedIDs = append(selectedIDs, character.ID)
		}
	}
	if len(selectedIDs) == 0 {
		t.Fatal("test catalog has no answerable characters")
	}

	tests := []struct {
		name         string
		schema       int
		rules        map[string]any
		assertFields func(*testing.T, map[string]string)
	}{
		{
			name:   "v1",
			schema: 1,
			rules: map[string]any{
				"hiddenFields": []string{"locations"},
				"turnSeconds":  60,
			},
			assertFields: func(t *testing.T, modes map[string]string) {
				if modes["locations"] != "hidden" {
					t.Fatalf("v1 locations mode = %q, want hidden", modes["locations"])
				}
			},
		},
		{
			name:   "v2",
			schema: 2,
			rules: map[string]any{
				"fields": map[string]any{
					"firstAppearance": true,
					"releaseYear":     "exactOnly",
					"species":         true,
					"affiliations":    true,
					"locations":       true,
					"hairColors":      false,
				},
				"turnLimit":  map[string]any{"enabled": false, "seconds": 30},
				"guessLimit": map[string]any{"enabled": true, "maxGuesses": 9},
			},
			assertFields: func(t *testing.T, modes map[string]string) {
				if modes["releaseYear"] != "exactOnly" || modes["hairColors"] != "hidden" {
					t.Fatalf("v2 field modes were not migrated: %+v", modes)
				}
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			resp, payload := request(http.MethodPost, "/api/puzzles/random", map[string]any{
				"questionScope": map[string]any{
					"schemaVersion":        test.schema,
					"catalogVersion":       version,
					"mode":                 "custom",
					"difficulty":           "custom",
					"selectedCharacterIds": selectedIDs,
					"workStates":           []any{},
					"rules":                test.rules,
				},
			})
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("legacy config status %d: %s", resp.StatusCode, payload)
			}
			var created openapi.PuzzleResponse
			if err := json.Unmarshal(payload, &created); err != nil {
				t.Fatal(err)
			}
			if created.Session.QuestionScope == nil {
				t.Fatal("normalized question scope is missing")
			}
			scope := created.Session.QuestionScope
			if scope.SchemaVersion != 3 {
				t.Fatalf("schema version = %d, want 3", scope.SchemaVersion)
			}
			test.assertFields(t, scope.Rules.FieldModes)
		})
	}
}

func TestMultiplayerSearchUsesFrozenQuestionScope(t *testing.T) {
	for _, mode := range []string{"race", "relay"} {
		t.Run(mode, func(t *testing.T) {
			fixture := createMatchFixtureMode(t, "bo1", mode, 30)
			snapshot := startMatch(t, fixture)
			if snapshot.Match == nil || snapshot.Match.QuestionScope == nil {
				t.Fatalf("%s match lacks frozen search context: %+v", mode, snapshot.Match)
			}
			characters := catalogCharactersForVersion(t, snapshot.Match.CatalogVersion)
			expected := expectedQuestionScopeSearchIDs(characters, snapshot.Match.QuestionScope.SelectedCharacterIds)
			path := fmt.Sprintf(
				"/api/characters/search?limit=250&roomId=%s&matchIndex=%d",
				url.QueryEscape(fixture.roomID),
				snapshot.Match.MatchIndex,
			)
			searchResp, searchPayload := fastRequest(http.MethodGet, path, nil)
			if searchResp.StatusCode != http.StatusOK {
				t.Fatalf("%s scoped search status %d: %s", mode, searchResp.StatusCode, searchPayload)
			}
			assertSearchResultIDs(t, searchPayload, expected)
		})
	}
}

func TestQuestionScopeSearchFilterCanBeDisabled(t *testing.T) {
	resp, payload := request(http.MethodPost, "/api/puzzles/random", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("create random status %d: %s", resp.StatusCode, payload)
	}
	var created openapi.PuzzleResponse
	if err := json.Unmarshal(payload, &created); err != nil {
		t.Fatal(err)
	}
	if created.Session.QuestionScope == nil || created.Session.CatalogVersion == nil {
		t.Fatalf("created session lacks frozen search context: %+v", created.Session)
	}
	characters := catalogCharactersForVersion(t, *created.Session.CatalogVersion)
	outside := outOfScopeGuessableCharacter(t, characters, created.Session.QuestionScope.SelectedCharacterIds)
	query := url.QueryEscape(outside.Names.ZhHans)

	enabledResp, enabledPayload := request(
		http.MethodGet,
		"/api/characters/search?sessionId="+url.QueryEscape(created.Session.Id)+"&q="+query,
		nil,
	)
	if enabledResp.StatusCode != http.StatusOK {
		t.Fatalf("enabled scoped search status %d: %s", enabledResp.StatusCode, enabledPayload)
	}
	var enabledSearch openapi.CharacterSearchResponse
	if err := json.Unmarshal(enabledPayload, &enabledSearch); err != nil {
		t.Fatal(err)
	}
	if searchContainsCharacter(enabledSearch, outside.ID) {
		t.Fatalf("enabled scope filter returned %s", outside.ID)
	}

	disabledServer := httptest.NewServer(server.NewWithOptions(
		pool,
		handler.WithCharacterSearchConfig(handler.CharacterSearchConfig{QuestionScopeFilterEnabled: false}),
	))
	defer disabledServer.Close()
	disabledResp, err := disabledServer.Client().Get(
		disabledServer.URL + "/api/characters/search?sessionId=" + url.QueryEscape(created.Session.Id) + "&q=" + query,
	)
	if err != nil {
		t.Fatal(err)
	}
	defer disabledResp.Body.Close()
	disabledPayload, err := io.ReadAll(disabledResp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if disabledResp.StatusCode != http.StatusOK {
		t.Fatalf("disabled scoped search status %d: %s", disabledResp.StatusCode, disabledPayload)
	}
	var disabledSearch openapi.CharacterSearchResponse
	if err := json.Unmarshal(disabledPayload, &disabledSearch); err != nil {
		t.Fatal(err)
	}
	if !searchContainsCharacter(disabledSearch, outside.ID) {
		t.Fatalf("disabled scope filter should restore %s: %+v", outside.ID, disabledSearch)
	}

	catalogResp, catalogPayload := request(http.MethodGet, "/api/characters/search?q="+query, nil)
	if catalogResp.StatusCode != http.StatusOK {
		t.Fatalf("catalog search status %d: %s", catalogResp.StatusCode, catalogPayload)
	}
	var catalogSearch openapi.CharacterSearchResponse
	if err := json.Unmarshal(catalogPayload, &catalogSearch); err != nil {
		t.Fatal(err)
	}
	if !searchContainsCharacter(catalogSearch, outside.ID) {
		t.Fatalf("catalog search should remain unscoped for %s", outside.ID)
	}
}

func TestSearchFiltersByWorkIDs(t *testing.T) {
	resp, payload := request(http.MethodGet, "/api/characters/search?workIds=th01_hrtp&q=%E7%81%B5%E6%A2%A6", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d: %s", resp.StatusCode, payload)
	}
	var search openapi.CharacterSearchResponse
	if err := json.Unmarshal(payload, &search); err != nil {
		t.Fatal(err)
	}
	if search.Total != 1 || len(search.Results) != 1 {
		t.Fatalf("expected 1 filtered result, got %+v", search)
	}
	if search.Results[0].WorkId != "th01_hrtp" {
		t.Fatalf("unexpected work id: %+v", search.Results[0])
	}

	emptyResp, emptyPayload := request(http.MethodGet, "/api/characters/search?workIds=th07_pcb&q=%E7%81%B5%E6%A2%A6", nil)
	if emptyResp.StatusCode != http.StatusOK {
		t.Fatalf("status %d: %s", emptyResp.StatusCode, emptyPayload)
	}
	var emptySearch openapi.CharacterSearchResponse
	if err := json.Unmarshal(emptyPayload, &emptySearch); err != nil {
		t.Fatal(err)
	}
	if emptySearch.Total != 0 || len(emptySearch.Results) != 0 {
		t.Fatalf("expected empty filtered result, got %+v", emptySearch)
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

func TestSessionSearchUsesBoundCatalogSnapshot(t *testing.T) {
	_, createPayload := request(http.MethodPost, "/api/puzzles/random", nil)
	var created openapi.PuzzleResponse
	if err := json.Unmarshal(createPayload, &created); err != nil {
		t.Fatal(err)
	}

	var originalVersion string
	var originalSnapshot []byte
	if err := pool.QueryRow(ctx, `
		SELECT state.current_version, snapshot.characters
		FROM catalog_state state
		JOIN catalog_snapshot snapshot ON snapshot.version = state.current_version
		WHERE state.id = 'current'
	`).Scan(&originalVersion, &originalSnapshot); err != nil {
		t.Fatal(err)
	}
	var currentCharacters []game.Character
	if err := json.Unmarshal(originalSnapshot, &currentCharacters); err != nil {
		t.Fatal(err)
	}
	withoutReimu := make([]game.Character, 0, len(currentCharacters)-1)
	for _, character := range currentCharacters {
		if character.ID != "reimu_hakurei" {
			withoutReimu = append(withoutReimu, character)
		}
	}
	newSnapshot, err := json.Marshal(withoutReimu)
	if err != nil {
		t.Fatal(err)
	}
	temporaryVersion := originalVersion + "-without-reimu"
	if _, err := pool.Exec(ctx, `INSERT INTO catalog_snapshot (version, characters) VALUES ($1, $2)`, temporaryVersion, newSnapshot); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE catalog_state SET current_version = $1 WHERE id = 'current'`, temporaryVersion); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if _, restoreErr := pool.Exec(ctx, `UPDATE catalog_state SET current_version = $1 WHERE id = 'current'`, originalVersion); restoreErr != nil {
			t.Errorf("restore current catalog version: %v", restoreErr)
			return
		}
		if _, deleteErr := pool.Exec(ctx, `DELETE FROM catalog_snapshot WHERE version = $1`, temporaryVersion); deleteErr != nil {
			t.Errorf("delete temporary catalog snapshot: %v", deleteErr)
		}
	}()

	_, currentPayload := request(http.MethodGet, "/api/characters/search?q=%E7%81%B5%E6%A2%A6", nil)
	var current openapi.CharacterSearchResponse
	if err := json.Unmarshal(currentPayload, &current); err != nil {
		t.Fatal(err)
	}
	if searchContainsCharacter(current, "reimu_hakurei") {
		t.Fatalf("current catalog should exclude Reimu: %+v", current)
	}

	path := "/api/characters/search?q=%E7%81%B5%E6%A2%A6&sessionId=" + created.Session.Id
	resp, snapshotPayload := request(http.MethodGet, path, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("snapshot search status %d: %s", resp.StatusCode, snapshotPayload)
	}
	var snapshot openapi.CharacterSearchResponse
	if err := json.Unmarshal(snapshotPayload, &snapshot); err != nil {
		t.Fatal(err)
	}
	if !searchContainsCharacter(snapshot, "reimu_hakurei") {
		t.Fatalf("session snapshot should include Reimu: %+v", snapshot)
	}

	guessResp, guessPayload := request(
		http.MethodPost,
		"/api/sessions/"+created.Session.Id+"/guess",
		map[string]string{"guessId": "reimu_hakurei"},
	)
	if guessResp.StatusCode != http.StatusOK {
		t.Fatalf("snapshot guess status %d: %s", guessResp.StatusCode, guessPayload)
	}
}

func TestSessionSearchPaginationAndMissingSession(t *testing.T) {
	_, createPayload := request(http.MethodPost, "/api/puzzles/random", nil)
	var created openapi.PuzzleResponse
	if err := json.Unmarshal(createPayload, &created); err != nil {
		t.Fatal(err)
	}

	path := "/api/characters/search?sessionId=" + created.Session.Id + "&sort=appearance&direction=desc&limit=2&offset=1"
	resp, payload := request(http.MethodGet, path, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d: %s", resp.StatusCode, payload)
	}
	var search openapi.CharacterSearchResponse
	if err := json.Unmarshal(payload, &search); err != nil {
		t.Fatal(err)
	}
	if search.Total <= 0 || len(search.Results) != 2 {
		t.Fatalf("unexpected page: %+v", search)
	}
	if search.Results[0].AppearanceOrder < search.Results[1].AppearanceOrder {
		t.Fatalf("results are not descending: %+v", search.Results)
	}

	missingResp, missingPayload := request(
		http.MethodGet,
		"/api/characters/search?sessionId=missing",
		nil,
	)
	if missingResp.StatusCode != http.StatusNotFound {
		t.Fatalf("missing session status %d: %s", missingResp.StatusCode, missingPayload)
	}
	if apiErr := decodeError(t, missingPayload); apiErr.Code != "SESSION_NOT_FOUND" {
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

func TestSinglePlayerSessionsStayOpenBeforeGuessLimit(t *testing.T) {
	for _, testCase := range []struct {
		name string
		path string
		body any
	}{
		{name: "daily normal", path: "/api/puzzles/daily", body: map[string]string{"difficulty": "normal"}},
		{name: "random", path: "/api/puzzles/random"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			createResp, createPayload := request(http.MethodPost, testCase.path, testCase.body)
			if createResp.StatusCode != http.StatusOK {
				t.Fatalf("create status %d: %s", createResp.StatusCode, createPayload)
			}
			var created openapi.PuzzleResponse
			if err := json.Unmarshal(createPayload, &created); err != nil {
				t.Fatal(err)
			}
			if created.Session.MaxGuesses != 8 {
				t.Fatalf("max guesses = %d, want 8", created.Session.MaxGuesses)
			}

			var answerID string
			if err := pool.QueryRow(ctx,
				`SELECT answer_id FROM game_session WHERE id = $1`, created.Session.Id,
			).Scan(&answerID); err != nil {
				t.Fatal(err)
			}
			rows, err := pool.Query(ctx,
				`SELECT id FROM character WHERE enabled_as_guess AND id <> $1 ORDER BY id LIMIT 7`,
				answerID)
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
			if len(guessIDs) != 7 {
				t.Fatalf("wrong guesses = %d, want 7", len(guessIDs))
			}

			for index, guessID := range guessIDs {
				resp, payload := request(
					http.MethodPost,
					"/api/sessions/"+created.Session.Id+"/guess",
					map[string]string{"guessId": guessID},
				)
				if resp.StatusCode != http.StatusOK {
					t.Fatalf("guess %d status %d: %s", index+1, resp.StatusCode, payload)
				}
				var wrapper struct {
					Session openapi.PublicGameSession `json:"session"`
				}
				if err := json.Unmarshal(payload, &wrapper); err != nil {
					t.Fatal(err)
				}
				if wrapper.Session.Status != "playing" {
					t.Fatalf("guess %d ended session with %s", index+1, wrapper.Session.Status)
				}
				if len(wrapper.Session.Guesses) != index+1 {
					t.Fatalf("guess %d returned %d records", index+1, len(wrapper.Session.Guesses))
				}
			}
		})
	}
}

func TestDailyPuzzleRejectsExtraDifficulty(t *testing.T) {
	resp, payload := request(http.MethodPost, "/api/puzzles/daily", map[string]string{
		"difficulty": "extra",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("daily extra status %d: %s, want 400", resp.StatusCode, payload)
	}
	if apiErr := decodeError(t, payload); apiErr.Code != "INVALID_REQUEST" {
		t.Fatalf("daily extra error = %+v, want INVALID_REQUEST", apiErr)
	}
}

func TestForfeitSessionRevealsAnswer(t *testing.T) {
	_, createPayload := request(http.MethodPost, "/api/puzzles/random", nil)
	var created openapi.PuzzleResponse
	if err := json.Unmarshal(createPayload, &created); err != nil {
		t.Fatal(err)
	}
	sessionID := created.Session.Id

	var answerID string
	if err := pool.QueryRow(ctx,
		`SELECT answer_id FROM game_session WHERE id = $1`, sessionID,
	).Scan(&answerID); err != nil {
		t.Fatal(err)
	}

	resp, payload := request(http.MethodPost, "/api/sessions/"+sessionID+"/forfeit", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("forfeit status %d: %s", resp.StatusCode, payload)
	}
	var wrapper struct {
		Session openapi.PublicGameSession `json:"session"`
	}
	if err := json.Unmarshal(payload, &wrapper); err != nil {
		t.Fatal(err)
	}
	session := wrapper.Session
	if session.Status != "lost" || session.Answer == nil || session.Answer.Id != answerID {
		t.Fatalf("unexpected forfeited state: %+v", session)
	}
	if session.EndedAt == nil {
		t.Fatal("endedAt missing after forfeit")
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

// TestUnknownRouteIs404 回归：echo v5 内建 ErrNotFound 为未导出 httpError 类型，
// 只实现 StatusCode()（非 *echo.HTTPError）——错误映射必须按状态码处理，不得落入 500 兜底。
func TestUnknownRouteIs404(t *testing.T) {
	resp, payload := request(http.MethodGet, "/api/no-such-path", nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown route status %d: %s", resp.StatusCode, payload)
	}
	if apiErr := decodeError(t, payload); apiErr.Code != "INVALID_REQUEST" {
		t.Fatalf("unexpected error: %+v", apiErr)
	}
}

// TestCatalogCharacters 完整可猜角色表：版本 + 全量 + 本地搜索字段齐全。
func TestCatalogCharacters(t *testing.T) {
	resp, payload := request(http.MethodGet, "/api/catalog/characters", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d: %s", resp.StatusCode, payload)
	}
	var table openapi.CatalogCharacters
	if err := json.Unmarshal(payload, &table); err != nil {
		t.Fatal(err)
	}
	if table.Version == "" {
		t.Fatal("version 为空")
	}
	if len(table.Characters) < 100 {
		t.Fatalf("角色数 %d < 100（TH20 目录应全量返回）", len(table.Characters))
	}
	for _, ch := range table.Characters {
		if ch.SearchText == "" {
			t.Fatalf("%s 缺 searchText", ch.Id)
		}
		if ch.NameSortKey == "" {
			t.Fatalf("%s 缺 nameSortKey", ch.Id)
		}
	}
	// version 与 CatalogState.currentVersion 一致（seed 后变化即可检测表更新）
	var dbVersion string
	if err := pool.QueryRow(ctx, "SELECT current_version FROM catalog_state WHERE id = 'current'").Scan(&dbVersion); err != nil {
		t.Fatal(err)
	}
	if table.Version != dbVersion {
		t.Fatalf("version %s != db %s", table.Version, dbVersion)
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

func TestConcurrentTimeoutsForSameTurnAreIdempotent(t *testing.T) {
	createResp, createPayload := request(
		http.MethodPost,
		"/api/puzzles/daily",
		map[string]string{"difficulty": "hard"},
	)
	if createResp.StatusCode != http.StatusOK {
		t.Fatalf("create status %d: %s", createResp.StatusCode, createPayload)
	}
	var created openapi.PuzzleResponse
	if err := json.Unmarshal(createPayload, &created); err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	statuses := make([]int, 2)
	for index := range statuses {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			resp, _ := request(
				http.MethodPost,
				"/api/sessions/"+created.Session.Id+"/timeout",
				map[string]int{"expectedGuessCount": 0},
			)
			statuses[index] = resp.StatusCode
		}(index)
	}
	wg.Wait()
	for index, status := range statuses {
		if status != http.StatusOK {
			t.Fatalf("timeout %d status %d", index+1, status)
		}
	}

	resp, payload := request(http.MethodGet, "/api/sessions/"+created.Session.Id, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get session status %d: %s", resp.StatusCode, payload)
	}
	var wrapper struct {
		Session openapi.PublicGameSession `json:"session"`
	}
	if err := json.Unmarshal(payload, &wrapper); err != nil {
		t.Fatal(err)
	}
	if wrapper.Session.Status != "playing" {
		t.Fatalf("status = %s, want playing", wrapper.Session.Status)
	}
	if len(wrapper.Session.Guesses) != 1 {
		t.Fatalf("timeout records = %d, want 1", len(wrapper.Session.Guesses))
	}
	if wrapper.Session.Guesses[0].Kind != "timeout" {
		t.Fatalf("unexpected timeout record: %+v", wrapper.Session.Guesses[0])
	}
}

func TestConcurrentGuessAndTimeoutConsumeOneTurn(t *testing.T) {
	createResp, createPayload := request(
		http.MethodPost,
		"/api/puzzles/daily",
		map[string]string{"difficulty": "hard"},
	)
	if createResp.StatusCode != http.StatusOK {
		t.Fatalf("create status %d: %s", createResp.StatusCode, createPayload)
	}
	var created openapi.PuzzleResponse
	if err := json.Unmarshal(createPayload, &created); err != nil {
		t.Fatal(err)
	}

	var guessID string
	if err := pool.QueryRow(ctx,
		`SELECT id FROM character
		 WHERE enabled_as_guess
		   AND id <> (SELECT answer_id FROM game_session WHERE id = $1)
		 ORDER BY id
		 LIMIT 1`,
		created.Session.Id,
	).Scan(&guessID); err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	statuses := make([]int, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		resp, _ := request(
			http.MethodPost,
			"/api/sessions/"+created.Session.Id+"/guess",
			map[string]any{"guessId": guessID, "expectedGuessCount": 0},
		)
		statuses[0] = resp.StatusCode
	}()
	go func() {
		defer wg.Done()
		resp, _ := request(
			http.MethodPost,
			"/api/sessions/"+created.Session.Id+"/timeout",
			map[string]int{"expectedGuessCount": 0},
		)
		statuses[1] = resp.StatusCode
	}()
	wg.Wait()

	if statuses[0] != http.StatusOK && statuses[0] != http.StatusConflict {
		t.Fatalf("guess status %d", statuses[0])
	}
	if statuses[1] != http.StatusOK {
		t.Fatalf("timeout status %d", statuses[1])
	}

	resp, payload := request(http.MethodGet, "/api/sessions/"+created.Session.Id, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get session status %d: %s", resp.StatusCode, payload)
	}
	var wrapper struct {
		Session openapi.PublicGameSession `json:"session"`
	}
	if err := json.Unmarshal(payload, &wrapper); err != nil {
		t.Fatal(err)
	}
	if wrapper.Session.Status != "playing" {
		t.Fatalf("status = %s, want playing", wrapper.Session.Status)
	}
	if len(wrapper.Session.Guesses) != 1 {
		t.Fatalf("records = %d, want 1", len(wrapper.Session.Guesses))
	}
}
