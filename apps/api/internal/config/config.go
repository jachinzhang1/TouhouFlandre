// Package config 读取环境配置。
package config

import (
	"os"
	"strings"
)

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
