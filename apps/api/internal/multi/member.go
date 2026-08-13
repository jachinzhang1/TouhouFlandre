package multi

import (
	"strings"
	"unicode"
)

// DefaultDisplayName 空昵称时的默认展示名（08 §5.2）。
const DefaultDisplayName = "匿名玩家"

// MaxDisplayNameRunes 昵称最大长度（08 §5.2：≤16 字符）。
const MaxDisplayNameRunes = 16

// ValidPlayerLimit applies the server-side capacity bounds for each mode.
func ValidPlayerLimit(mode MultiplayerMode, playerLimit int) bool {
	switch mode {
	case MultiplayerModeRace:
		return playerLimit >= DefaultPlayerLimit && playerLimit <= ServerMaxRacePlayers
	case MultiplayerModeRelay:
		return playerLimit == RelayPlayerLimit
	default:
		return false
	}
}

// NormalizeDisplayName 昵称规范化（08 §5.2）：trim + 去控制字符 + ≤16 字符；
// 结果为空则给默认「匿名玩家」。
func NormalizeDisplayName(name string) string {
	trimmed := strings.TrimSpace(name)
	var builder strings.Builder
	for _, r := range trimmed {
		if unicode.IsControl(r) {
			continue
		}
		builder.WriteRune(r)
	}
	cleaned := strings.TrimSpace(builder.String())
	runes := []rune(cleaned)
	if len(runes) > MaxDisplayNameRunes {
		runes = runes[:MaxDisplayNameRunes]
	}
	if len(runes) == 0 {
		return DefaultDisplayName
	}
	return string(runes)
}
