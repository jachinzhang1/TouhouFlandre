package multi

import (
	"strings"
	"unicode"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
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
		return playerLimit == 2 || playerLimit == 4 || playerLimit == 6 || playerLimit == 8
	default:
		return false
	}
}

func RelayReadyDecision(players []repo.MultiMember, playerLimit int) (allowed bool, reason string) {
	if len(players) < MinPlayers {
		return false, "not_enough_players"
	}
	if len(players) > playerLimit {
		return false, "invalid_player_count"
	}
	if len(players)%2 != 0 {
		return false, "odd_player_count"
	}
	hostReady := false
	for _, player := range players {
		if player.Status != string(MemberStatusConnected) {
			return false, "player_disconnected"
		}
		if !player.Ready {
			return false, "player_not_ready"
		}
		if MemberSeat(player) == 1 {
			hostReady = true
		}
	}
	if !hostReady {
		return false, "host_missing"
	}
	return true, ""
}

// ReadyRoster reports whether the room's current player collection may be
// frozen as a match roster. The capacity is an upper bound, not a target.
func ReadyRoster(players []repo.MultiMember, playerLimit int) bool {
	if len(players) < MinPlayers || len(players) > playerLimit {
		return false
	}
	hostReady := false
	for _, player := range players {
		if !IsPlayer(player) || player.Status != string(MemberStatusConnected) || !player.Ready {
			return false
		}
		if MemberSeat(player) == 1 {
			hostReady = true
		}
	}
	return hostReady
}

// RematchRosterReady reports whether the preserved player collection is a
// complete, connected roster whose members have all confirmed the next match.
func RematchRosterReady(players []repo.MultiMember, playerLimit int) bool {
	if len(players) < MinPlayers || len(players) > playerLimit {
		return false
	}
	hasHost := false
	for _, player := range players {
		if !IsPlayer(player) || player.Status != string(MemberStatusConnected) || !player.RematchReady {
			return false
		}
		if MemberSeat(player) == 1 {
			hasHost = true
		}
	}
	return hasHost
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
