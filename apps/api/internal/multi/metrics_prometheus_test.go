package multi

import (
	"strings"
	"testing"
	"time"
)

func TestPrometheusMetricsUseBoundedSafeRuleSetLabels(t *testing.T) {
	metrics := &Metrics{}
	invalidLabels := []MetricLabels{
		NewMetricLabels("relay", "unrevealed-answer-sentinel", 1),
		NewMetricLabels("unregistered-mode", "wins", 1),
		NewMetricLabels("relay", "fixed_points", 999),
	}
	for _, unsafe := range invalidLabels {
		if unsafe != (MetricLabels{Mode: "unknown", RuleSetKey: "unknown", RuleSetVersion: 0}) {
			t.Fatalf("invalid labels were not collapsed: %+v", unsafe)
		}
	}
	unsafe := invalidLabels[0]
	metrics.SetActiveEncounters(map[MetricLabels]int64{unsafe: 4})
	metrics.RecordHistoryLatency(unsafe, 25*time.Millisecond)
	metrics.RecordSnapshotBytes(unsafe, 2048)
	metrics.IncDeadlock(unsafe)
	text := metrics.PrometheusText()
	if strings.Contains(text, "unrevealed-answer-sentinel") || strings.Contains(text, "999") {
		t.Fatalf("unsafe persisted labels leaked through metrics:\n%s", text)
	}
	for _, expected := range []string{
		`touhouflandre_multi_active_encounters{mode="unknown",rule_set_key="unknown",rule_set_version="0"} 4`,
		`touhouflandre_multi_history_latency_seconds_count{mode="unknown",rule_set_key="unknown",rule_set_version="0"} 1`,
		`touhouflandre_multi_snapshot_bytes_count{mode="unknown",rule_set_key="unknown",rule_set_version="0"} 1`,
		`touhouflandre_multi_deadlocks_total{mode="unknown",rule_set_key="unknown",rule_set_version="0"} 1`,
	} {
		if !strings.Contains(text, expected) {
			t.Fatalf("missing metric %q:\n%s", expected, text)
		}
	}
}

func TestGuessLatencySamplesAreBoundedAndExposeP99(t *testing.T) {
	metrics := &Metrics{}
	for index := 0; index < 5000; index++ {
		metrics.RecordGuessLatency(time.Duration(index+1) * time.Microsecond)
	}
	if len(metrics.guessLatency) != 4096 {
		t.Fatalf("guess samples=%d, want 4096", len(metrics.guessLatency))
	}
	quantile := quantiles(metrics.guessLatency)
	if quantile["p99"] == 0 || quantile["count"] != 4096 {
		t.Fatalf("quantiles=%+v", quantile)
	}
}
