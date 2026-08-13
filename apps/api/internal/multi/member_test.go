package multi

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
)

func TestNormalizeDisplayName(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", DefaultDisplayName},
		{"   ", DefaultDisplayName},
		{"\t\n", DefaultDisplayName},
		{" 灵梦  ", "灵梦"},
		{"博丽\u0000灵梦", "博丽灵梦"}, // 控制字符剔除
		{"很长很长的昵称abcdefghijklmnopqrst", "很长很长的昵称abcdefghi"}, // 截断到 16 rune
		{"1234567890123456", "1234567890123456"},            // 恰好 16
		{"12345678901234567", "1234567890123456"},           // 17 → 16
	}
	for _, c := range cases {
		if got := NormalizeDisplayName(c.in); got != c.want {
			t.Errorf("NormalizeDisplayName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestNormalizeDisplayNameControlCharOnly(t *testing.T) {
	// 全控制字符 + trim 后为空 → 默认名
	if got := NormalizeDisplayName("\x01\x02\x03"); got != DefaultDisplayName {
		t.Errorf("control-only name = %q, want %q", got, DefaultDisplayName)
	}
}

func TestValidPlayerLimit(t *testing.T) {
	cases := []struct {
		name        string
		mode        MultiplayerMode
		playerLimit int
		want        bool
	}{
		{name: "race default", mode: MultiplayerModeRace, playerLimit: DefaultPlayerLimit, want: true},
		{name: "race maximum", mode: MultiplayerModeRace, playerLimit: ServerMaxRacePlayers, want: true},
		{name: "race below minimum", mode: MultiplayerModeRace, playerLimit: DefaultPlayerLimit - 1},
		{name: "race above maximum", mode: MultiplayerModeRace, playerLimit: ServerMaxRacePlayers + 1},
		{name: "relay fixed capacity", mode: MultiplayerModeRelay, playerLimit: RelayPlayerLimit, want: true},
		{name: "relay rejects race capacity", mode: MultiplayerModeRelay, playerLimit: RelayPlayerLimit + 1},
		{name: "unknown mode", mode: MultiplayerMode("unknown"), playerLimit: DefaultPlayerLimit},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := ValidPlayerLimit(test.mode, test.playerLimit); got != test.want {
				t.Fatalf("ValidPlayerLimit(%q, %d) = %t, want %t", test.mode, test.playerLimit, got, test.want)
			}
		})
	}
}

func TestReadyRoster(t *testing.T) {
	player := func(seat int32, ready bool, status MemberStatus) repo.MultiMember {
		return repo.MultiMember{
			Seat:   pgtype.Int4{Int32: seat, Valid: true},
			Role:   string(ParticipantRolePlayer),
			Ready:  ready,
			Status: string(status),
		}
	}
	tests := []struct {
		name    string
		players []repo.MultiMember
		limit   int
		want    bool
	}{
		{name: "minimum ready", players: []repo.MultiMember{player(1, true, MemberStatusConnected), player(2, true, MemberStatusConnected)}, limit: 8, want: true},
		{name: "partially filled ready", players: []repo.MultiMember{player(1, true, MemberStatusConnected), player(2, true, MemberStatusConnected), player(3, true, MemberStatusConnected)}, limit: 8, want: true},
		{name: "at capacity ready", players: []repo.MultiMember{player(1, true, MemberStatusConnected), player(2, true, MemberStatusConnected), player(3, true, MemberStatusConnected)}, limit: 3, want: true},
		{name: "below minimum", players: []repo.MultiMember{player(1, true, MemberStatusConnected)}, limit: 8},
		{name: "over capacity", players: []repo.MultiMember{player(1, true, MemberStatusConnected), player(2, true, MemberStatusConnected), player(3, true, MemberStatusConnected)}, limit: 2},
		{name: "unready member", players: []repo.MultiMember{player(1, true, MemberStatusConnected), player(2, false, MemberStatusConnected)}, limit: 8},
		{name: "disconnected member", players: []repo.MultiMember{player(1, true, MemberStatusConnected), player(2, true, MemberStatusDisconnected)}, limit: 8},
		{name: "missing host", players: []repo.MultiMember{player(2, true, MemberStatusConnected), player(3, true, MemberStatusConnected)}, limit: 8},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := ReadyRoster(test.players, test.limit); got != test.want {
				t.Fatalf("ReadyRoster() = %t, want %t", got, test.want)
			}
		})
	}
}

func TestRematchRosterReady(t *testing.T) {
	player := func(seat int32, confirmed bool, status MemberStatus) repo.MultiMember {
		return repo.MultiMember{
			Seat:         pgtype.Int4{Int32: seat, Valid: true},
			Role:         string(ParticipantRolePlayer),
			RematchReady: confirmed,
			Status:       string(status),
		}
	}
	tests := []struct {
		name    string
		players []repo.MultiMember
		limit   int
		want    bool
	}{
		{name: "complete two player roster", players: []repo.MultiMember{player(1, true, MemberStatusConnected), player(2, true, MemberStatusConnected)}, limit: 2, want: true},
		{name: "complete flexible roster", players: []repo.MultiMember{player(1, true, MemberStatusConnected), player(2, true, MemberStatusConnected), player(3, true, MemberStatusConnected)}, limit: 8, want: true},
		{name: "confirmation missing", players: []repo.MultiMember{player(1, true, MemberStatusConnected), player(2, false, MemberStatusConnected)}, limit: 2},
		{name: "disconnected member", players: []repo.MultiMember{player(1, true, MemberStatusConnected), player(2, true, MemberStatusDisconnected)}, limit: 2},
		{name: "left member", players: []repo.MultiMember{player(1, true, MemberStatusConnected), player(2, true, MemberStatusLeft)}, limit: 2},
		{name: "missing host", players: []repo.MultiMember{player(2, true, MemberStatusConnected), player(3, true, MemberStatusConnected)}, limit: 3},
		{name: "below minimum", players: []repo.MultiMember{player(1, true, MemberStatusConnected)}, limit: 2},
		{name: "over capacity", players: []repo.MultiMember{player(1, true, MemberStatusConnected), player(2, true, MemberStatusConnected), player(3, true, MemberStatusConnected)}, limit: 2},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := RematchRosterReady(test.players, test.limit); got != test.want {
				t.Fatalf("RematchRosterReady() = %t, want %t", got, test.want)
			}
		})
	}
}
