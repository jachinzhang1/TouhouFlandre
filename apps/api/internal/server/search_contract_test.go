package server_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/handler"
	apiserver "github.com/TouhouFlandre/touhouflandre/apps/api/internal/server"
)

func requestWithHeaders(method, path string, headers map[string]string) (*http.Response, []byte) {
	req, err := http.NewRequest(method, baseURL+path, nil)
	if err != nil {
		panic(err)
	}
	for name, value := range headers {
		req.Header.Set(name, value)
	}
	resp, err := client.Do(req)
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()
	payload, _ := io.ReadAll(resp.Body)
	return resp, payload
}

func currentCatalogVersion(t *testing.T) string {
	t.Helper()
	var version string
	if err := pool.QueryRow(ctx, `SELECT current_version FROM catalog_state WHERE id = 'current'`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	return version
}

func TestCatalogSearchPolicyContract(t *testing.T) {
	resp, payload := request(http.MethodGet, "/api/catalog/search-policy", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d: %s", resp.StatusCode, payload)
	}
	if got := resp.Header.Get("Cache-Control"); got != "no-store" {
		t.Fatalf("cache-control=%q", got)
	}
	var policy openapi.CatalogSearchPolicy
	if err := json.Unmarshal(payload, &policy); err != nil {
		t.Fatal(err)
	}
	if policy.Mode != openapi.Remote || policy.GameScopeMode != openapi.Strict || policy.IndexSchemaVersion != 1 || policy.RevalidateAfterSeconds != 60 || policy.Revision == "" {
		t.Fatalf("unexpected policy: %+v", policy)
	}
}

func TestCatalogSearchIndexContractAndConditionalRequest(t *testing.T) {
	version := currentCatalogVersion(t)
	resp, payload := request(http.MethodGet, "/api/catalog/"+version+"/search-index/1", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d: %s", resp.StatusCode, payload)
	}
	if got := resp.Header.Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Fatalf("cache-control=%q", got)
	}
	etag := resp.Header.Get("ETag")
	if etag == "" {
		t.Fatal("missing etag")
	}
	var index openapi.CatalogSearchIndex
	if err := json.Unmarshal(payload, &index); err != nil {
		t.Fatal(err)
	}
	if index.CatalogVersion != version || index.IndexSchemaVersion != 1 || len(index.Entries) == 0 {
		t.Fatalf("unexpected index: version=%q schema=%d entries=%d", index.CatalogVersion, index.IndexSchemaVersion, len(index.Entries))
	}
	for _, entry := range index.Entries {
		if entry.Id == "" || len(entry.SearchTerms) == 0 || entry.NameSortKey == "" {
			t.Fatalf("incomplete entry: %+v", entry)
		}
		if strings.Contains(string(payload), `"enabledAsAnswer"`) || strings.Contains(string(payload), `"sourceRefs"`) {
			t.Fatal("index leaked answer/private fields")
		}
	}

	conditional, conditionalPayload := requestWithHeaders(http.MethodGet, "/api/catalog/"+version+"/search-index/1", map[string]string{"If-None-Match": etag})
	if conditional.StatusCode != http.StatusNotModified || len(conditionalPayload) != 0 {
		t.Fatalf("conditional status=%d payload=%s", conditional.StatusCode, conditionalPayload)
	}
	if conditional.Header.Get("ETag") != etag || conditional.Header.Get("Cache-Control") != resp.Header.Get("Cache-Control") {
		t.Fatalf("conditional headers etag=%q cache=%q", conditional.Header.Get("ETag"), conditional.Header.Get("Cache-Control"))
	}
}

func TestCatalogSearchIndexErrorsAreStableAndUncacheable(t *testing.T) {
	missing, missingPayload := request(http.MethodGet, "/api/catalog/missing-version/search-index/1", nil)
	if missing.StatusCode != http.StatusNotFound || decodeError(t, missingPayload).Code != "CATALOG_VERSION_NOT_FOUND" {
		t.Fatalf("missing status=%d payload=%s", missing.StatusCode, missingPayload)
	}
	if missing.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("missing cache-control=%q", missing.Header.Get("Cache-Control"))
	}
	unsupported, unsupportedPayload := request(http.MethodGet, "/api/catalog/"+currentCatalogVersion(t)+"/search-index/2", nil)
	if unsupported.StatusCode != http.StatusBadRequest || decodeError(t, unsupportedPayload).Code != "INVALID_REQUEST" {
		t.Fatalf("unsupported status=%d payload=%s", unsupported.StatusCode, unsupportedPayload)
	}
	if unsupported.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("unsupported cache-control=%q", unsupported.Header.Get("Cache-Control"))
	}
}

func TestCatalogSummaryCarriesCurrentVersion(t *testing.T) {
	version := currentCatalogVersion(t)
	resp, payload := request(http.MethodGet, "/api/catalog", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d: %s", resp.StatusCode, payload)
	}
	var summary openapi.CatalogSummary
	if err := json.Unmarshal(payload, &summary); err != nil {
		t.Fatal(err)
	}
	if summary.Version == nil || *summary.Version != version {
		t.Fatalf("summary version=%v, want %q", summary.Version, version)
	}
}

func TestCharacterSearchFallbackReasonCorsAndSemantics(t *testing.T) {
	resp, payload := requestWithHeaders(http.MethodGet, "/api/characters/search?q=reimu", map[string]string{"X-Character-Search-Fallback-Reason": "forged-value"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("search status=%d payload=%s", resp.StatusCode, payload)
	}
	preflight, _ := requestWithHeaders(http.MethodOptions, "/api/characters/search", map[string]string{
		"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "X-Character-Search-Fallback-Reason",
	})
	if preflight.StatusCode < 200 || preflight.StatusCode >= 300 {
		t.Fatalf("preflight status=%d", preflight.StatusCode)
	}
	if !strings.Contains(strings.ToLower(preflight.Header.Get("Access-Control-Allow-Headers")), "x-character-search-fallback-reason") {
		t.Fatalf("allow-headers=%q", preflight.Header.Get("Access-Control-Allow-Headers"))
	}
}

func TestSearchMetricsExposeOnlyLowCardinalityObservations(t *testing.T) {
	resp, payload := requestWithHeaders(
		http.MethodGet,
		"/api/characters/search?q=secret-query",
		map[string]string{"X-Character-Search-Fallback-Reason": "secret-reason"},
	)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("search status=%d payload=%s", resp.StatusCode, payload)
	}

	metricsResp, metricsPayload := request(http.MethodGet, "/metrics", nil)
	if metricsResp.StatusCode != http.StatusOK {
		t.Fatalf("metrics status=%d payload=%s", metricsResp.StatusCode, metricsPayload)
	}
	metrics := string(metricsPayload)
	for _, sensitive := range []string{"secret-query", "secret-reason"} {
		if strings.Contains(metrics, sensitive) {
			t.Fatalf("metrics leaked %q: %s", sensitive, metrics)
		}
	}
	if !strings.Contains(metrics, `touhouflandre_search_fallback_reason_total{reason="unknown"}`) {
		t.Fatalf("metrics did not normalize unknown fallback reason: %s", metrics)
	}
	if got := metricsResp.Header.Get("Cache-Control"); got != "no-store" {
		t.Fatalf("metrics cache-control=%q", got)
	}
}

func TestSnapshotProjectionFailureKeepsRemoteSearchAndReadinessAvailable(t *testing.T) {
	version := currentCatalogVersion(t)
	var loads atomic.Int32
	source := game.NewCatalogSearchSourceProvider(func(context.Context, string) ([]game.Character, error) {
		loads.Add(1)
		return []game.Character{searchContractCharacter("reimu")}, nil
	})
	snapshot := game.NewCatalogSearchSnapshotProvider(source, func(string, int, []game.Character) (game.CatalogSearchSnapshot, error) {
		return game.CatalogSearchSnapshot{}, errors.New("injected projection failure")
	})
	ts := httptest.NewServer(apiserver.NewWithOptions(pool, handler.WithCatalogSearchProviders(source, snapshot)))
	defer ts.Close()

	indexResp, indexPayload := requestAt(t, ts.Client(), ts.URL, "/api/catalog/"+version+"/search-index/1")
	if indexResp.StatusCode != http.StatusServiceUnavailable || decodeError(t, indexPayload).Code != "CATALOG_NOT_READY" {
		t.Fatalf("index status=%d payload=%s", indexResp.StatusCode, indexPayload)
	}
	searchResp, searchPayload := requestAt(t, ts.Client(), ts.URL, "/api/characters/search?catalogVersion="+version+"&q=reimu")
	if searchResp.StatusCode != http.StatusOK {
		t.Fatalf("remote search status=%d payload=%s", searchResp.StatusCode, searchPayload)
	}
	var result openapi.CharacterSearchResponse
	if err := json.Unmarshal(searchPayload, &result); err != nil {
		t.Fatal(err)
	}
	if result.Total != 1 || len(result.Results) != 1 || result.Results[0].Id != "reimu" {
		t.Fatalf("unexpected remote search result: %+v", result)
	}
	readyResp, readyPayload := requestAt(t, ts.Client(), ts.URL, "/readyz")
	if readyResp.StatusCode != http.StatusOK {
		t.Fatalf("readyz status=%d payload=%s", readyResp.StatusCode, readyPayload)
	}
	if got := loads.Load(); got != 1 {
		t.Fatalf("source loads=%d, want cached source to be reused", got)
	}
}

func TestSharedCatalogSnapshotFailureSurfacesFinalErrorsReadinessAndMetrics(t *testing.T) {
	version := currentCatalogVersion(t)
	var loads atomic.Int32
	source := game.NewCatalogSearchSourceProvider(func(context.Context, string) ([]game.Character, error) {
		loads.Add(1)
		return nil, errors.New("injected catalog snapshot failure")
	})
	snapshot := game.NewCatalogSearchSnapshotProvider(source, nil)
	ts := httptest.NewServer(apiserver.NewWithOptions(pool, handler.WithCatalogSearchProviders(source, snapshot)))
	defer ts.Close()

	indexResp, indexPayload := requestAt(t, ts.Client(), ts.URL, "/api/catalog/"+version+"/search-index/1")
	if indexResp.StatusCode != http.StatusServiceUnavailable || decodeError(t, indexPayload).Code != "CATALOG_NOT_READY" {
		t.Fatalf("index status=%d payload=%s", indexResp.StatusCode, indexPayload)
	}
	searchResp, searchPayload := requestAt(t, ts.Client(), ts.URL, "/api/characters/search?catalogVersion="+version+"&q=reimu")
	if searchResp.StatusCode != http.StatusInternalServerError || decodeError(t, searchPayload).Code != "INTERNAL" {
		t.Fatalf("remote search status=%d payload=%s", searchResp.StatusCode, searchPayload)
	}
	readyResp, readyPayload := requestAt(t, ts.Client(), ts.URL, "/readyz")
	if readyResp.StatusCode != http.StatusServiceUnavailable || !strings.Contains(string(readyPayload), "catalog search unavailable") {
		t.Fatalf("readyz status=%d payload=%s", readyResp.StatusCode, readyPayload)
	}
	if got := loads.Load(); got != 3 {
		t.Fatalf("source loads=%d, want one bounded attempt per request", got)
	}
	metricsResp, metricsPayload := requestAt(t, ts.Client(), ts.URL, "/metrics")
	if metricsResp.StatusCode != http.StatusOK {
		t.Fatalf("metrics status=%d payload=%s", metricsResp.StatusCode, metricsPayload)
	}
	metrics := string(metricsPayload)
	for _, sample := range []string{
		`touhouflandre_search_source_total{outcome="load_error"}`,
		`touhouflandre_search_snapshot_total{outcome="load_error"}`,
		`touhouflandre_search_remote_total{outcome="error"}`,
	} {
		if !strings.Contains(metrics, sample) {
			t.Fatalf("metrics missing %q: %s", sample, metrics)
		}
	}
}

func requestAt(t *testing.T, httpClient *http.Client, serverURL, path string) (*http.Response, []byte) {
	t.Helper()
	resp, err := httpClient.Get(serverURL + path)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return resp, payload
}

func searchContractCharacter(id string) game.Character {
	return game.Character{
		ID: id, EnabledAsGuess: true, AvatarURL: "/characters/" + id + ".png",
		Names:           game.LocalizedNames{ZhHans: "博丽灵梦", Ja: "博麗霊夢", En: "Reimu Hakurei", Aliases: []string{"reimu"}},
		FirstAppearance: game.FirstAppearance{WorkID: "th06", WorkTitle: "东方红魔乡", ReleaseYear: 2002},
	}
}
