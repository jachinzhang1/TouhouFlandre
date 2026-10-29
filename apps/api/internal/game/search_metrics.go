package game

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// SearchMetrics contains only fixed-cardinality search observations. No
// request data, catalog versions, or game identifiers are accepted as labels.
type SearchMetrics struct {
	mu         sync.Mutex
	counters   map[string]map[string]int64
	histograms map[string]*searchHistogram
}

type searchHistogram struct {
	count   uint64
	sum     float64
	buckets []uint64
}

var searchHistogramBounds = []float64{0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5}

var DefaultSearchMetrics = NewSearchMetrics()

func NewSearchMetrics() *SearchMetrics {
	return &SearchMetrics{counters: map[string]map[string]int64{}, histograms: map[string]*searchHistogram{}}
}

func (m *SearchMetrics) increment(name, label string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.counters[name] == nil {
		m.counters[name] = map[string]int64{}
	}
	m.counters[name][label]++
}

func normalizeSearchOutcome(value string) string {
	switch value {
	case "hit", "miss", "load_success", "load_error", "coalesced", "build_success", "build_error", "success", "error", "unsupported_schema":
		return value
	default:
		return "unknown"
	}
}

func normalizeSearchLayer(value string) string {
	if value == "source" || value == "snapshot" {
		return value
	}
	return "unknown"
}

func normalizeFallbackReason(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "none"
	}
	switch value {
	case "none", "policy_remote", "policy_unavailable", "context_incomplete", "index_transient", "index_invalid", "engine_error":
		return value
	default:
		return "unknown"
	}
}

func (m *SearchMetrics) IncPolicyOutcome(outcome string) {
	m.increment("policy", normalizeSearchOutcome(outcome))
}

func (m *SearchMetrics) IncProviderOutcome(layer, outcome string) {
	m.increment(normalizeSearchLayer(layer), normalizeSearchOutcome(outcome))
}

func (m *SearchMetrics) IncFallbackReason(reason string) {
	m.increment("fallback_reason", normalizeFallbackReason(reason))
}

func (m *SearchMetrics) IncRemoteOutcome(outcome string) {
	m.increment("remote", normalizeSearchOutcome(outcome))
}

func (m *SearchMetrics) ObserveIndexBuild(duration time.Duration) {
	m.observe("index_build_seconds", duration.Seconds())
}

func (m *SearchMetrics) ObserveRemoteLatency(duration time.Duration) {
	m.observe("remote_latency_seconds", duration.Seconds())
}

func (m *SearchMetrics) observe(name string, value float64) {
	if value < 0 {
		value = 0
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	histogram := m.histograms[name]
	if histogram == nil {
		histogram = &searchHistogram{buckets: make([]uint64, len(searchHistogramBounds))}
		m.histograms[name] = histogram
	}
	histogram.count++
	histogram.sum += value
	for index, bound := range searchHistogramBounds {
		if value <= bound {
			histogram.buckets[index]++
		}
	}
}

func (m *SearchMetrics) PrometheusText() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out strings.Builder
	writeSearchCounterFamily(&out, "touhouflandre_search_policy_total", "Search policy outcomes.", m.counters["policy"], "outcome")
	writeSearchCounterFamily(&out, "touhouflandre_search_source_total", "Search provider outcomes by layer.", m.counters["source"], "outcome")
	writeSearchCounterFamily(&out, "touhouflandre_search_snapshot_total", "Search snapshot provider outcomes.", m.counters["snapshot"], "outcome")
	writeSearchCounterFamily(&out, "touhouflandre_search_fallback_reason_total", "Remote search fallback reasons.", m.counters["fallback_reason"], "reason")
	writeSearchCounterFamily(&out, "touhouflandre_search_remote_total", "Remote search outcomes.", m.counters["remote"], "outcome")
	for _, name := range []string{"index_build_seconds", "remote_latency_seconds"} {
		fullName := "touhouflandre_search_" + name
		histogram := m.histograms[name]
		fmt.Fprintf(&out, "# HELP %s Search %s.\n# TYPE %s histogram\n", fullName, strings.ReplaceAll(name, "_", " "), fullName)
		if histogram == nil {
			continue
		}
		for index, bound := range searchHistogramBounds {
			fmt.Fprintf(&out, "%s_bucket{le=%q} %d\n", fullName, strconv.FormatFloat(bound, 'g', -1, 64), histogram.buckets[index])
		}
		fmt.Fprintf(&out, "%s_bucket{le=\"+Inf\"} %d\n", fullName, histogram.count)
		fmt.Fprintf(&out, "%s_sum %s\n%s_count %d\n", fullName, strconv.FormatFloat(histogram.sum, 'g', -1, 64), fullName, histogram.count)
	}
	return out.String()
}

func writeSearchCounterFamily(out *strings.Builder, name, help string, values map[string]int64, labelName string) {
	fmt.Fprintf(out, "# HELP %s %s\n# TYPE %s counter\n", name, help, name)
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		fmt.Fprintf(out, "%s{%s=%q} %d\n", name, labelName, key, values[key])
	}
}
