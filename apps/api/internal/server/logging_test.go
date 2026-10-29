package server

import (
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v5"
)

func TestSafeRequestLogURIUsesRoutePatternWithoutSensitiveValues(t *testing.T) {
	e := echo.New()
	c := e.NewContext(
		httptest.NewRequest("GET", "/api/characters/search?q=secret&sessionId=session-1", nil),
		httptest.NewRecorder(),
	)

	if got := safeRequestLogURI(c, "/api/characters/search"); got != "/api/characters/search" {
		t.Fatalf("safe route URI = %q", got)
	}
	if got := safeRequestLogURI(c, ""); got != "api.unmatched" {
		t.Fatalf("safe unmatched URI = %q", got)
	}
}
