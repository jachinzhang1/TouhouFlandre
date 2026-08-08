// 多人时间常量（08 §4.7，默认值全部可配置；Phase 6 统一接入 internal/config）。
package multi

import "time"

// TimingConfig 对局时间常量。
type TimingConfig struct {
	RoundCountdown    time.Duration // 首局倒计时（仅 round 1）
	Intermission      time.Duration // 局间间歇（下一局 startsAt = 上局 ended_at + 此值，兼作倒计时）
	RoundSeconds      time.Duration // 单局整局时限（超时平局）
	TurnSeconds       time.Duration // 接力模式单用户猜测时限默认值
	DisconnectGrace   time.Duration // 断线宽限期
	MaxRoundsFactor   int           // 总局数安全上限系数（maxRounds = factor × N）
	FinishedRetention time.Duration // 对局结束展示期
}

// DefaultTimingConfig 08 §4.7 默认值。
func DefaultTimingConfig() TimingConfig {
	return TimingConfig{
		RoundCountdown:    3 * time.Second,
		Intermission:      5 * time.Second,
		RoundSeconds:      900 * time.Second,
		TurnSeconds:       60 * time.Second,
		DisconnectGrace:   60 * time.Second,
		MaxRoundsFactor:   3,
		FinishedRetention: 30 * time.Minute,
	}
}
