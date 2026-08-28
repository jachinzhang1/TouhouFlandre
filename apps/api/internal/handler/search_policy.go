package handler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
)

const searchImmutableCacheControl = "public, max-age=31536000, immutable"

func normalizeFallbackReason(value string) string {
	switch strings.TrimSpace(value) {
	case "none", "policy_remote", "policy_unavailable", "context_incomplete", "index_transient", "index_invalid", "engine_error":
		return strings.TrimSpace(value)
	default:
		return "unknown"
	}
}

func (s *Server) CatalogSearchPolicy(_ context.Context, _ openapi.CatalogSearchPolicyRequestObject) (openapi.CatalogSearchPolicyResponseObject, error) {
	mode := openapi.Remote
	if s.characterSearch.Mode == "local-primary" {
		mode = openapi.LocalPrimary
	}
	scopeMode := openapi.Full
	if s.characterSearch.QuestionScopeFilterEnabled {
		scopeMode = openapi.Strict
	}
	const schemaVersion = game.SearchIndexSchemaVersion
	policy := openapi.CatalogSearchPolicy{
		Mode:                   mode,
		IndexSchemaVersion:     schemaVersion,
		Revision:               searchPolicyRevision(s.characterSearch.PolicyRevision, string(mode), string(scopeMode), schemaVersion),
		GameScopeMode:          scopeMode,
		RevalidateAfterSeconds: openapi.CatalogSearchPolicyRevalidateAfterSecondsN60,
	}
	cacheControl := "no-store"
	game.DefaultSearchMetrics.IncPolicyOutcome("success")
	return openapi.CatalogSearchPolicy200JSONResponse{
		Body:    policy,
		Headers: openapi.CatalogSearchPolicy200ResponseHeaders{CacheControl: &cacheControl},
	}, nil
}

func searchPolicyRevision(base, mode, scope string, schema int) string {
	digest := sha256.Sum256([]byte(strings.Join([]string{base, mode, scope, strconv.Itoa(schema)}, "\x00")))
	return base + "-" + hex.EncodeToString(digest[:8])
}

func (s *Server) CatalogSearchIndex(ctx context.Context, request openapi.CatalogSearchIndexRequestObject) (openapi.CatalogSearchIndexResponseObject, error) {
	if _, err := s.q.GetCatalogState(ctx); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, &ApiError{Status: http.StatusServiceUnavailable, Code: codeCatalogNotReady, Message: "题库尚未初始化，请先运行 seed。"}
		}
		return nil, internalError(err)
	}
	snapshot, err := s.searchSnapshot.Get(ctx, request.CatalogVersion, request.IndexSchemaVersion)
	if err != nil {
		switch {
		case errors.Is(err, game.ErrUnsupportedSearchIndexSchema):
			return nil, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidRequest, Message: "不支持的搜索索引版本。"}
		case errors.Is(err, pgx.ErrNoRows):
			return nil, &ApiError{Status: http.StatusNotFound, Code: codeCatalogVersionNotFound, Message: "没有找到题库版本：" + request.CatalogVersion}
		default:
			return nil, &ApiError{Status: http.StatusServiceUnavailable, Code: codeCatalogNotReady, Message: "题库搜索索引暂时不可用。"}
		}
	}
	etag := snapshot.ETag
	if matchesETag(ifNoneMatch(ctx), etag) {
		cacheControl := searchImmutableCacheControl
		return openapi.CatalogSearchIndex304Response{
			Headers: openapi.CatalogSearchIndex304ResponseHeaders{CacheControl: &cacheControl, ETag: &etag},
		}, nil
	}
	cacheControl := searchImmutableCacheControl
	return openapi.CatalogSearchIndex200JSONResponse{
		Body:    toOpenAPICatalogSearchIndex(snapshot.Index),
		Headers: openapi.CatalogSearchIndex200ResponseHeaders{CacheControl: &cacheControl, ETag: &etag},
	}, nil
}

func matchesETag(header, etag string) bool {
	for _, candidate := range strings.Split(header, ",") {
		candidate = strings.TrimSpace(candidate)
		if candidate == "*" || candidate == etag || strings.TrimPrefix(candidate, "W/") == etag {
			return true
		}
	}
	return false
}
