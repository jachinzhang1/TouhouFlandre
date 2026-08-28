package game

import (
	"strings"
	"testing"
	"time"
)

func TestSearchMetricsFoldUnknownValuesAndAvoidSensitiveLabels(t *testing.T) {
	metrics := NewSearchMetrics()
	metrics.IncPolicyOutcome("query-secret")
	metrics.IncProviderOutcome("catalog-v1", "hit")
	metrics.IncFallbackReason("")
	metrics.IncFallbackReason("room-secret")
	metrics.IncRemoteOutcome("success")
	metrics.ObserveIndexBuild(time.Millisecond)
	metrics.ObserveRemoteLatency(2 * time.Millisecond)

	text := metrics.PrometheusText()
	if !strings.Contains(text, `outcome="unknown"`) || !strings.Contains(text, `reason="none"`) {
		t.Fatalf("missing folded labels:\n%s", text)
	}
	if strings.Contains(text, "catalog-v1") || strings.Contains(text, "room-secret") || strings.Contains(text, "query-secret") {
		t.Fatalf("sensitive/high-cardinality value leaked:\n%s", text)
	}
}
