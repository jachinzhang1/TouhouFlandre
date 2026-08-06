// Package config 读取环境配置。
package config

import (
	"os"
	"strconv"
	"strings"
	"time"
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
