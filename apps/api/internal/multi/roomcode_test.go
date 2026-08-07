package multi

import (
	"strings"
	"testing"
)

func TestGenerateRoomCode(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 2000; i++ {
		code := GenerateRoomCode()
		if len(code) != RoomCodeLength {
			t.Fatalf("code length %d != %d: %s", len(code), RoomCodeLength, code)
		}
		for _, r := range code {
			if !strings.ContainsRune(roomCodeAlphabet, r) {
				t.Fatalf("code contains char outside alphabet: %q in %s", r, code)
			}
		}
		seen[code] = true
	}
	if len(seen) < 1900 {
		t.Fatalf("2000 次生成碰撞过多：仅 %d 个不同值", len(seen))
	}
}

func TestNormalizeRoomCode(t *testing.T) {
	cases := []struct{ in, want string }{
		{"abc123", "ABC123"},
		{"  abc 123 ", "ABC123"},
		{"ab-c1-23", "ABC123"},
		{"AB-C123", "ABC123"},
		{"", ""},
	}
	for _, c := range cases {
		if got := NormalizeRoomCode(c.in); got != c.want {
			t.Errorf("NormalizeRoomCode(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
