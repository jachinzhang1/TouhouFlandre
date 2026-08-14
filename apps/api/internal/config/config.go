// Package config 读取环境配置。
package config

import (
	"crypto/rand"
	"crypto/sha256"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
)

var (
	projectionSecretOnce sync.Once
	projectionSecret     []byte
)

// durationFromEnv 读取时长环境变量，非法/缺失时回退默认值。
func durationFromEnv(key string, fallback time.Duration) time.Duration {
	if raw := os.Getenv(key); raw != "" {
		if d, err := time.ParseDuration(raw); err == nil {
			return d
		}
	}
	return fallback
}

// DatabaseURL 返回 Postgres 连接串（.env 的 DATABASE_URL_PG）。
func DatabaseURL() string {
	return os.Getenv("DATABASE_URL_PG")
}

// CatalogDataDir 返回题库 JSON 目录（packages/data/src）。
func CatalogDataDir() string {
	if dir := os.Getenv("CATALOG_DATA_DIR"); dir != "" {
		return dir
	}
	return "../../packages/data/src"
}

// APIPort 返回服务监听端口（.env 的 API_PORT，默认 4000）。
func APIPort() string {
	if port := os.Getenv("API_PORT"); port != "" {
		return port
	}
	return "4000"
}

// WebOrigins 返回允许跨源的站点来源（.env 的 WEB_ORIGINS，逗号分隔）。
func WebOrigins() []string {
	value := os.Getenv("WEB_ORIGINS")
	if value == "" {
		return []string{"http://localhost:5173", "http://127.0.0.1:5173"}
	}
	var origins []string
	for _, origin := range strings.Split(value, ",") {
		if trimmed := strings.TrimSpace(origin); trimmed != "" {
			origins = append(origins, trimmed)
		}
	}
	return origins
}

// MultiLobbyTTL 大厅无人加入的房间过期时长（MULTI_LOBBY_TTL，默认 30min，08 §4.7）。
func MultiLobbyTTL() time.Duration {
	return durationFromEnv("MULTI_LOBBY_TTL", 30*time.Minute)
}

// MultiEventRetention closed 到删除的保留时长（MULTI_EVENT_RETENTION，默认 24h，08 §4.7/§9.1）。
func MultiEventRetention() time.Duration {
	return durationFromEnv("MULTI_EVENT_RETENTION", 24*time.Hour)
}

// MultiChatRetention 聊天消息逻辑/物理保留期（默认 24h）。
func MultiChatRetention() time.Duration {
	return durationFromEnv("MULTI_CHAT_RETENTION", 24*time.Hour)
}

func positiveIntFromEnv(key string, fallback int) int {
	if raw := os.Getenv(key); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			return n
		}
	}
	return fallback
}

func boolFromEnv(key string, fallback bool) bool {
	if raw := strings.TrimSpace(os.Getenv(key)); raw != "" {
		switch strings.ToLower(raw) {
		case "1", "true", "t", "yes", "y", "on":
			return true
		case "0", "false", "f", "no", "n", "off":
			return false
		}
	}
	return fallback
}

// MultiNPlayerRaceEnabled 控制是否允许新建/调高 2 人以上竞速房间。
// MPX-010 发布闸门要求默认保持双人容量；已有多人房间的 join/对局推进不受影响。
func MultiNPlayerRaceEnabled() bool {
	return boolFromEnv("MULTI_N_PLAYER_RACE_ENABLED", true)
}

// MultiChatSendEnabled 控制是否允许写入新聊天消息。历史读取和已授权实时投影不受影响。
func MultiChatSendEnabled() bool {
	return boolFromEnv("MULTI_CHAT_SEND_ENABLED", true)
}

// MultiChatRate 两级聊天 token bucket 配置。
func MultiChatRate() multi.ChatRateConfig {
	return multi.ChatRateConfig{
		MemberCapacity: positiveIntFromEnv("MULTI_CHAT_MEMBER_CAPACITY", 5),
		MemberRefill:   durationFromEnv("MULTI_CHAT_MEMBER_REFILL", 2*time.Second),
		RoomCapacity:   positiveIntFromEnv("MULTI_CHAT_ROOM_CAPACITY", 20),
		RoomRefill:     durationFromEnv("MULTI_CHAT_ROOM_REFILL", 500*time.Millisecond),
	}
}

// MultiChatCursorSecret 返回聊天 cursor 的 HMAC 密钥。未单独配置时从多人投影密钥
// 做域隔离派生，避免在不同协议用途间直接复用同一密钥材料。
func MultiChatCursorSecret() []byte {
	if raw := os.Getenv("MULTI_CHAT_CURSOR_SECRET"); raw != "" {
		return []byte(raw)
	}
	derived := sha256.Sum256(append([]byte("multi-chat-cursor-v1:"), MultiProjectionSecret()...))
	return derived[:]
}

// MultiJoinRateLimit 加入/预检按 IP 限流次数（MULTI_JOIN_RATE_LIMIT，默认 10 次/分，08 §8.5）。
// dev/E2E 并行场景需要更高额度，提供环境覆盖（Phase 2 曾定「不进配置」，见执行记录偏差）。
func MultiJoinRateLimit() int {
	if raw := os.Getenv("MULTI_JOIN_RATE_LIMIT"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			return n
		}
	}
	return 10
}

// MultiRoundCountdown 首局倒计时（MULTI_ROUND_COUNTDOWN，默认 3s，08 §4.7）。
func MultiRoundCountdown() time.Duration {
	return durationFromEnv("MULTI_ROUND_COUNTDOWN", 3*time.Second)
}

// MultiIntermission 局间间歇（MULTI_INTERMISSION，默认 5s，08 §4.7；兼作下一局倒计时）。
func MultiIntermission() time.Duration {
	return durationFromEnv("MULTI_INTERMISSION", 5*time.Second)
}

// MultiRoundSeconds 接力模式单局整局时限（MULTI_ROUND_SECONDS，默认 900s）。
func MultiRoundSeconds() time.Duration {
	return durationFromEnv("MULTI_ROUND_SECONDS", 900*time.Second)
}

// MultiRaceRoundSeconds 竞速模式单局整局时限（MULTI_RACE_ROUND_SECONDS，默认 300s）。
func MultiRaceRoundSeconds() time.Duration {
	return durationFromEnv("MULTI_RACE_ROUND_SECONDS", 300*time.Second)
}

// MultiTurnSeconds 接力模式单用户猜测时限默认值（MULTI_TURN_SECONDS，默认 60s）。
// 房主创建接力房间时可在 30/60/90/120 秒中选择，env 仅作为后端兜底默认。
func MultiTurnSeconds() time.Duration {
	return durationFromEnv("MULTI_TURN_SECONDS", 60*time.Second)
}

// MultiDisconnectGrace 断线宽限期（MULTI_DISCONNECT_GRACE，默认 60s，08 §4.7）。
func MultiDisconnectGrace() time.Duration {
	return durationFromEnv("MULTI_DISCONNECT_GRACE", 60*time.Second)
}

// MultiMaxRoundsFactor 总局数安全上限系数（MULTI_MAX_ROUNDS_FACTOR，默认 3，08 §4.7；maxRounds = factor × N）。
func MultiMaxRoundsFactor() int {
	if raw := os.Getenv("MULTI_MAX_ROUNDS_FACTOR"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			return n
		}
	}
	return 3
}

// MultiFinishedRetention 对局结束展示期（MULTI_FINISHED_RETENTION，默认 10min，08 §4.7）。
func MultiFinishedRetention() time.Duration {
	return durationFromEnv("MULTI_FINISHED_RETENTION", 10*time.Minute)
}

// MultiWSReadLimit 客户端 WS 消息读限（MULTI_WS_READ_LIMIT，默认 4096，08 §8.5）。
func MultiWSReadLimit() int64 {
	if raw := os.Getenv("MULTI_WS_READ_LIMIT"); raw != "" {
		if n, err := strconv.ParseInt(raw, 10, 64); err == nil && n > 0 {
			return n
		}
	}
	return 4096
}

// MultiWSSendQueue 发送队列长度（MULTI_WS_SEND_QUEUE，默认 64，08 §8.5）。
func MultiWSSendQueue() int {
	if raw := os.Getenv("MULTI_WS_SEND_QUEUE"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			return n
		}
	}
	return 64
}

// MultiProjectionSecret 返回对手棋盘匿名列置换的服务端秘密。
// 生产环境应显式配置 MULTI_PROJECTION_SECRET；本地/测试未配置时为当前进程生成 256-bit 随机值，
// 禁止回退到可由公开 room/member 标识推导的固定种子。
func MultiProjectionSecret() []byte {
	if raw := os.Getenv("MULTI_PROJECTION_SECRET"); raw != "" {
		return []byte(raw)
	}
	projectionSecretOnce.Do(func() {
		projectionSecret = make([]byte, 32)
		if _, err := rand.Read(projectionSecret); err != nil {
			panic("config: generate multiplayer projection secret: " + err.Error())
		}
	})
	return append([]byte(nil), projectionSecret...)
}

// MultiTiming 组装对局时间常量（08 §4.7 全量，env 可覆盖）。
func MultiTiming() multi.TimingConfig {
	return multi.TimingConfig{
		RoundCountdown:    MultiRoundCountdown(),
		Intermission:      MultiIntermission(),
		RoundSeconds:      MultiRoundSeconds(),
		RaceRoundSeconds:  MultiRaceRoundSeconds(),
		TurnSeconds:       MultiTurnSeconds(),
		DisconnectGrace:   MultiDisconnectGrace(),
		MaxRoundsFactor:   MultiMaxRoundsFactor(),
		FinishedRetention: MultiFinishedRetention(),
	}
}

// LogLevel 应用日志级别（LOG_LEVEL: debug/info/warn/error，默认 info）。
func LogLevel() slog.Level {
	switch strings.ToLower(os.Getenv("LOG_LEVEL")) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
