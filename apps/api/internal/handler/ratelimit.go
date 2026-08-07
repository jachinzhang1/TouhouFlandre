// 按 IP 速率限制（08 §8.5：加入与公开预检共用，默认每分钟 10 次，进程内计数、单实例）。
package handler

import (
	"sync"
	"time"
)

type rateWindow struct {
	start time.Time
	count int
}

// ipRateLimiter 固定窗口按 IP 计数；窗口过期即重置（无需后台清理）。
type ipRateLimiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	counts map[string]rateWindow
}

func newIPRateLimiter(limit int, window time.Duration) *ipRateLimiter {
	return &ipRateLimiter{limit: limit, window: window, counts: map[string]rateWindow{}}
}

// allow 返回该 IP 在当前窗口内是否仍有配额。
func (l *ipRateLimiter) allow(ip string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	w, ok := l.counts[ip]
	if !ok || now.Sub(w.start) >= l.window {
		l.counts[ip] = rateWindow{start: now, count: 1}
		return true
	}
	w.count++
	l.counts[ip] = w
	return w.count <= l.limit
}
