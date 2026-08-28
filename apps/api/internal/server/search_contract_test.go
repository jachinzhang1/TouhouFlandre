package server_test

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
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
