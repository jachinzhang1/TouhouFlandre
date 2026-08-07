// 进程内指标（Prometheus 语义；正式暴露端点由 Stage 5 决定，08 §11.2 清单）。
// 仓库暂无 prometheus 客户端依赖 → 原子计数 + 直方采样 + Snapshot 供测试/日志兜底。
package multi

import (
	"sort"
	"sync"
	"time"
)

// Metrics 多人模式指标。
type Metrics struct {
	mu              sync.Mutex
	eventsTotal     map[string]int64    // events_total{type}
	forfeitsTotal   map[string]int64    // forfeits_total{reason}
	roomsByStatus   map[string]int64    // rooms{status}
	membersByStatus map[string]int64    // members{status}
	wsConnections   int64               // ws_connections（当前值）
	activeRounds    int64               // active_rounds（当前值）
	reconnectsTotal int64               // reconnects_total
	guessLatency    []time.Duration     // guess_latency 采样（p50/p95 在 Snapshot 计算）
}

// DefaultMetrics 全局指标实例（sweeper/hub/handler 共用）。
var DefaultMetrics = &Metrics{
	eventsTotal:     map[string]int64{},
	forfeitsTotal:   map[string]int64{},
	roomsByStatus:   map[string]int64{},
	membersByStatus: map[string]int64{},
}

// IncEvents events_total{type}。
func (m *Metrics) IncEvents(eventType string) {
	m.mu.Lock()
	m.eventsTotal[eventType]++
	m.mu.Unlock()
}

// IncForfeits forfeits_total{reason}。
func (m *Metrics) IncForfeits(reason string) {
	m.mu.Lock()
	m.forfeitsTotal[reason]++
	m.mu.Unlock()
}

// IncReconnects reconnects_total。
func (m *Metrics) IncReconnects() {
	m.mu.Lock()
	m.reconnectsTotal++
	m.mu.Unlock()
}

// AddWsConnections ws_connections 增量（连接注册 +1 / 注销 -1）。
func (m *Metrics) AddWsConnections(delta int64) {
	m.mu.Lock()
	m.wsConnections += delta
	m.mu.Unlock()
}

// SetRoomStatuses rooms{status} 直方（sweeper 采集时聚合）。
func (m *Metrics) SetRoomStatuses(counts map[string]int64) {
	m.mu.Lock()
	m.roomsByStatus = counts
	m.mu.Unlock()
}

// SetMemberStatuses members{status} 直方。
func (m *Metrics) SetMemberStatuses(counts map[string]int64) {
	m.mu.Lock()
	m.membersByStatus = counts
	m.mu.Unlock()
}

// SetActiveRounds active_rounds。
func (m *Metrics) SetActiveRounds(count int64) {
	m.mu.Lock()
	m.activeRounds = count
	m.mu.Unlock()
}

// RecordGuessLatency 猜测耗时采样。
func (m *Metrics) RecordGuessLatency(d time.Duration) {
	m.mu.Lock()
	m.guessLatency = append(m.guessLatency, d)
	m.mu.Unlock()
}

// Snapshot 复制当前指标（测试/日志读取；量级小，直接拷贝）。
func (m *Metrics) Snapshot() map[string]any {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string]any{
		"eventsTotal":     cloneMap(m.eventsTotal),
		"forfeitsTotal":   cloneMap(m.forfeitsTotal),
		"roomsByStatus":   cloneMap(m.roomsByStatus),
		"membersByStatus": cloneMap(m.membersByStatus),
		"wsConnections":   m.wsConnections,
		"activeRounds":    m.activeRounds,
		"reconnectsTotal": m.reconnectsTotal,
	}
	if len(m.guessLatency) > 0 {
		out["guessLatency"] = quantiles(m.guessLatency)
	}
	return out
}

func cloneMap(src map[string]int64) map[string]int64 {
	out := make(map[string]int64, len(src))
	for k, v := range src {
		out[k] = v
	}
	return out
}

// quantiles 计算 p50/p95（升序样本）。
func quantiles(samples []time.Duration) map[string]time.Duration {
	sorted := append([]time.Duration(nil), samples...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	at := func(p float64) time.Duration {
		if len(sorted) == 0 {
			return 0
		}
		idx := int(float64(len(sorted)-1) * p)
		return sorted[idx]
	}
	return map[string]time.Duration{"p50": at(0.5), "p95": at(0.95), "count": time.Duration(len(sorted))}
}
