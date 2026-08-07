package multi

import (
	"testing"
)

func TestNormalizeDisplayName(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", DefaultDisplayName},
		{"   ", DefaultDisplayName},
		{"\t\n", DefaultDisplayName},
		{" 灵梦  ", "灵梦"},
		{"博丽\u0000灵梦", "博丽灵梦"},          // 控制字符剔除
		{"很长很长的昵称abcdefghijklmnopqrst", "很长很长的昵称abcdefghi"}, // 截断到 16 rune
		{"1234567890123456", "1234567890123456"}, // 恰好 16
		{"12345678901234567", "1234567890123456"}, // 17 → 16
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
