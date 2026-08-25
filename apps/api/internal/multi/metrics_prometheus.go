package multi

import (
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

// MetricLabels is deliberately low-cardinality. Unknown persisted values are
// collapsed instead of becoming labels or leaking data through /metrics.
type MetricLabels struct {
	Mode           string
	RuleSetKey     string
	RuleSetVersion int
}

var allowedMetricRuleSets = map[string]bool{
	"wins": true, "points": true, "placement": true,
	"legacy_wins": true, "fixed_points": true, "elimination": true,
}

func NewMetricLabels(mode, ruleSetKey string, ruleSetVersion int) MetricLabels {
	if (mode != "race" && mode != "relay") || !allowedMetricRuleSets[ruleSetKey] || ruleSetVersion != 1 {
		return MetricLabels{Mode: "unknown", RuleSetKey: "unknown", RuleSetVersion: 0}
	}
	return MetricLabels{Mode: mode, RuleSetKey: ruleSetKey, RuleSetVersion: ruleSetVersion}
}

var metricHistogramBounds = []float64{0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15, 60, 300, 1500, 65536, 262144, 1048576}

type metricHistogram struct {
	count   uint64
	sum     float64
	buckets []uint64
}

func newMetricHistogram() *metricHistogram {
	return &metricHistogram{buckets: make([]uint64, len(metricHistogramBounds))}
}

func (h *metricHistogram) observe(value float64) {
	h.count++
	h.sum += value
	for index, bound := range metricHistogramBounds {
		if value <= bound {
			h.buckets[index]++
		}
	}
}

func (m *Metrics) SetActiveEncounters(counts map[MetricLabels]int64) {
	m.mu.Lock()
	m.activeEncounters = make(map[MetricLabels]int64, len(counts))
	for labels, count := range counts {
		m.activeEncounters[NewMetricLabels(labels.Mode, labels.RuleSetKey, labels.RuleSetVersion)] = count
	}
	m.mu.Unlock()
}

func (m *Metrics) incrementLabeled(name string, labels MetricLabels) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.labeledCounters == nil {
		m.labeledCounters = map[string]map[MetricLabels]int64{}
	}
	if m.labeledCounters[name] == nil {
		m.labeledCounters[name] = map[MetricLabels]int64{}
	}
	labels = NewMetricLabels(labels.Mode, labels.RuleSetKey, labels.RuleSetVersion)
	m.labeledCounters[name][labels]++
}

func (m *Metrics) observeLabeled(name string, labels MetricLabels, value float64) {
	if value < 0 {
		value = 0
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.labeledHistograms == nil {
		m.labeledHistograms = map[string]map[MetricLabels]*metricHistogram{}
	}
	if m.labeledHistograms[name] == nil {
		m.labeledHistograms[name] = map[MetricLabels]*metricHistogram{}
	}
	labels = NewMetricLabels(labels.Mode, labels.RuleSetKey, labels.RuleSetVersion)
	histogram := m.labeledHistograms[name][labels]
	if histogram == nil {
		histogram = newMetricHistogram()
		m.labeledHistograms[name][labels] = histogram
	}
	histogram.observe(value)
}

func (m *Metrics) IncTurnTimeout(labels MetricLabels) {
	m.incrementLabeled("turn_timeouts_total", labels)
}
func (m *Metrics) IncPairingFailure(labels MetricLabels) {
	m.incrementLabeled("pairing_failures_total", labels)
}
func (m *Metrics) IncPoolTooSmall(labels MetricLabels) {
	m.incrementLabeled("pool_too_small_total", labels)
}
func (m *Metrics) IncSettlementRetry(labels MetricLabels) {
	m.incrementLabeled("settlement_retries_total", labels)
}
func (m *Metrics) IncDeadlock(labels MetricLabels) { m.incrementLabeled("deadlocks_total", labels) }
func (m *Metrics) IncWSQueueDrop(labels MetricLabels) {
	m.incrementLabeled("ws_queue_drops_total", labels)
}
func (m *Metrics) RecordStageDuration(labels MetricLabels, value time.Duration) {
	m.observeLabeled("stage_duration_seconds", labels, value.Seconds())
}
func (m *Metrics) RecordEncounterDuration(labels MetricLabels, value time.Duration) {
	m.observeLabeled("encounter_duration_seconds", labels, value.Seconds())
}
func (m *Metrics) RecordStageBarrierWait(labels MetricLabels, value time.Duration) {
	m.observeLabeled("stage_barrier_wait_seconds", labels, value.Seconds())
}
func (m *Metrics) RecordGuessLatencyFor(labels MetricLabels, value time.Duration) {
	m.observeLabeled("guess_latency_seconds", labels, value.Seconds())
}
func (m *Metrics) RecordHistoryLatency(labels MetricLabels, value time.Duration) {
	m.observeLabeled("history_latency_seconds", labels, value.Seconds())
}
func (m *Metrics) RecordSnapshotBytes(labels MetricLabels, value int) {
	m.observeLabeled("snapshot_bytes", labels, float64(value))
}
func (m *Metrics) RecordWSPayloadBytes(labels MetricLabels, value int) {
	m.observeLabeled("ws_payload_bytes", labels, float64(value))
}

func (m *Metrics) PrometheusHandler() http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		response.Header().Set("Cache-Control", "no-store")
		_, _ = io.WriteString(response, m.PrometheusText())
	})
}

func (m *Metrics) PrometheusText() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out strings.Builder
	writeGaugeFamily(&out, "touhouflandre_multi_rooms", "Multiplayer rooms by status.", m.roomsByStatus, "status")
	writeGaugeFamily(&out, "touhouflandre_multi_members", "Multiplayer members by status.", m.membersByStatus, "status")
	fmt.Fprintf(&out, "# TYPE touhouflandre_multi_ws_connections gauge\ntouhouflandre_multi_ws_connections %d\n", m.wsConnections)
	fmt.Fprintf(&out, "# TYPE touhouflandre_multi_active_rounds gauge\ntouhouflandre_multi_active_rounds %d\n", m.activeRounds)
	fmt.Fprintf(&out, "# TYPE touhouflandre_multi_reconnects_total counter\ntouhouflandre_multi_reconnects_total %d\n", m.reconnectsTotal)
	writeCounterFamily(&out, "touhouflandre_multi_events_total", "Persisted multiplayer events.", m.eventsTotal, "type")
	writeCounterFamily(&out, "touhouflandre_multi_forfeits_total", "Multiplayer forfeits by reason.", m.forfeitsTotal, "reason")

	writeMetricHeader(&out, "touhouflandre_multi_active_encounters", "gauge", "Active relay encounters by frozen ruleset.")
	for _, labels := range sortedMetricLabels(m.activeEncounters) {
		fmt.Fprintf(&out, "touhouflandre_multi_active_encounters%s %d\n", prometheusLabels(labels, ""), m.activeEncounters[labels])
	}
	counterNames := []string{"turn_timeouts_total", "pairing_failures_total", "pool_too_small_total", "settlement_retries_total", "deadlocks_total", "ws_queue_drops_total"}
	for _, name := range counterNames {
		fullName := "touhouflandre_multi_" + name
		writeMetricHeader(&out, fullName, "counter", "Multiplayer "+strings.ReplaceAll(name, "_", " ")+".")
		for _, labels := range sortedMetricLabels(m.labeledCounters[name]) {
			fmt.Fprintf(&out, "%s%s %d\n", fullName, prometheusLabels(labels, ""), m.labeledCounters[name][labels])
		}
	}
	histogramNames := []string{"guess_latency_seconds", "stage_duration_seconds", "encounter_duration_seconds", "stage_barrier_wait_seconds", "history_latency_seconds", "snapshot_bytes", "ws_payload_bytes"}
	for _, name := range histogramNames {
		fullName := "touhouflandre_multi_" + name
		writeMetricHeader(&out, fullName, "histogram", "Multiplayer "+strings.ReplaceAll(name, "_", " ")+".")
		for _, labels := range sortedMetricLabels(m.labeledHistograms[name]) {
			histogram := m.labeledHistograms[name][labels]
			for index, bound := range metricHistogramBounds {
				fmt.Fprintf(&out, "%s_bucket%s %d\n", fullName, prometheusLabels(labels, strconv.FormatFloat(bound, 'g', -1, 64)), histogram.buckets[index])
			}
			fmt.Fprintf(&out, "%s_bucket%s %d\n", fullName, prometheusLabels(labels, "+Inf"), histogram.count)
			fmt.Fprintf(&out, "%s_sum%s %s\n", fullName, prometheusLabels(labels, ""), strconv.FormatFloat(histogram.sum, 'g', -1, 64))
			fmt.Fprintf(&out, "%s_count%s %d\n", fullName, prometheusLabels(labels, ""), histogram.count)
		}
	}
	return out.String()
}

func writeMetricHeader(out *strings.Builder, name, kind, help string) {
	fmt.Fprintf(out, "# HELP %s %s\n# TYPE %s %s\n", name, help, name, kind)
}

func writeGaugeFamily(out *strings.Builder, name, help string, values map[string]int64, labelName string) {
	writeMetricHeader(out, name, "gauge", help)
	writeStringMap(out, name, values, labelName)
}

func writeCounterFamily(out *strings.Builder, name, help string, values map[string]int64, labelName string) {
	writeMetricHeader(out, name, "counter", help)
	writeStringMap(out, name, values, labelName)
}

func writeStringMap(out *strings.Builder, name string, values map[string]int64, labelName string) {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		fmt.Fprintf(out, "%s{%s=%q} %d\n", name, labelName, key, values[key])
	}
}

func sortedMetricLabels[T any](values map[MetricLabels]T) []MetricLabels {
	labels := make([]MetricLabels, 0, len(values))
	for label := range values {
		labels = append(labels, label)
	}
	sort.Slice(labels, func(i, j int) bool {
		left, right := labels[i], labels[j]
		if left.Mode != right.Mode {
			return left.Mode < right.Mode
		}
		if left.RuleSetKey != right.RuleSetKey {
			return left.RuleSetKey < right.RuleSetKey
		}
		return left.RuleSetVersion < right.RuleSetVersion
	})
	return labels
}

func prometheusLabels(labels MetricLabels, bucket string) string {
	parts := []string{
		fmt.Sprintf("mode=%q", labels.Mode),
		fmt.Sprintf("rule_set_key=%q", labels.RuleSetKey),
		fmt.Sprintf("rule_set_version=%q", strconv.Itoa(labels.RuleSetVersion)),
	}
	if bucket != "" {
		parts = append(parts, fmt.Sprintf("le=%q", bucket))
	}
	return "{" + strings.Join(parts, ",") + "}"
}
