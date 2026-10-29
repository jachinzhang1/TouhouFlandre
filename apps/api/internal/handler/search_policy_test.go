package handler

import (
	"context"
	"testing"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
)

func TestSearchPolicyRevisionIsStableAndConfigurationBound(t *testing.T) {
	base := searchPolicyRevision("v1", "remote", "strict", 1)
	if base == "" || base != searchPolicyRevision("v1", "remote", "strict", 1) {
		t.Fatalf("revision is not stable: %q", base)
	}
	for _, changed := range []string{
		searchPolicyRevision("v1", "local-primary", "strict", 1),
		searchPolicyRevision("v1", "remote", "full", 1),
		searchPolicyRevision("v1", "remote", "strict", 2),
		searchPolicyRevision("v2", "remote", "strict", 1),
	} {
		if changed == base {
			t.Fatalf("configuration change did not change revision: %q", changed)
		}
	}
}

func TestSearchPolicyResponseUsesConfiguredModeAndScope(t *testing.T) {
	server := &Server{characterSearch: CharacterSearchConfig{Mode: "local-primary", PolicyRevision: "v1", QuestionScopeFilterEnabled: false}}
	response, err := server.CatalogSearchPolicy(context.Background(), openapi.CatalogSearchPolicyRequestObject{})
	if err != nil {
		t.Fatal(err)
	}
	policy := response.(openapi.CatalogSearchPolicy200JSONResponse)
	if policy.Body.Mode != openapi.LocalPrimary || policy.Body.GameScopeMode != openapi.Full || policy.Body.RevalidateAfterSeconds != 60 {
		t.Fatalf("unexpected policy: %+v", policy.Body)
	}
	if policy.Headers.CacheControl == nil || *policy.Headers.CacheControl != "no-store" {
		t.Fatalf("policy cache header=%v", policy.Headers.CacheControl)
	}
}

func TestFallbackReasonNormalization(t *testing.T) {
	if got := normalizeFallbackReason(" policy_remote "); got != "policy_remote" {
		t.Fatalf("normalized reason=%q", got)
	}
	if got := normalizeFallbackReason(""); got != "unknown" {
		t.Fatalf("empty reason=%q", got)
	}
	if got := normalizeFallbackReason("query-secret"); got != "unknown" {
		t.Fatalf("unknown reason=%q", got)
	}
}

func TestMatchesETag(t *testing.T) {
	if !matchesETag(`"etag-1"`, `"etag-1"`) || !matchesETag(`W/"etag-1"`, `"etag-1"`) || !matchesETag("*", `"etag-1"`) {
		t.Fatal("expected matching etags")
	}
	if matchesETag(`"etag-2"`, `"etag-1"`) {
		t.Fatal("unexpected etag match")
	}
}
