package multi

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
)

// GuestTokenPrefix 令牌类型前缀（08 §5.1：guest: 游客 / jwt: 未来账号，类型不匹配 → GUEST_UNAUTHORIZED）。
const GuestTokenPrefix = "guest:"

// GenerateGuestToken 签发游客令牌：crypto/rand 32 字节 → base64url（无填充）。
// 令牌即凭据，库中只存 sha256(token) 哈希（明文只在签发响应中出现一次）。
func GenerateGuestToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

// HashToken 计算令牌哈希（sha256 hex，存 multi_member.token_hash）。
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
