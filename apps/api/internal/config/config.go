// Package config 读取环境配置。
package config

import "os"

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

// APIPort 返回 Go 服务监听端口（.env 的 API_PORT_GO，默认 4100）。
func APIPort() string {
	if port := os.Getenv("API_PORT_GO"); port != "" {
		return port
	}
	return "4100"
}
