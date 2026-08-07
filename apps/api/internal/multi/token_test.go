package multi

import (
	"strings"
	"testing"
)

func TestGenerateGuestToken(t *testing.T) {
	token, err := GenerateGuestToken()
	if err != nil {
		t.Fatal(err)
	}
	// base64url 无填充：32 字节 → 43 字符
	if len(token) != 43 {
		t.Fatalf("token length %d, want 43", len(token))
	}
	if strings.ContainsAny(token, "+/=") {
		t.Fatalf("token 含 base64 填充/非 url 字符: %s", token)
	}
	other, _ := GenerateGuestToken()
	if token == other {
		t.Fatal("两次生成相同令牌")
	}
}

func TestHashToken(t *testing.T) {
	a := HashToken("secret-token")
	if len(a) != 64 {
		t.Fatalf("hash length %d, want 64", len(a))
	}
	if a != HashToken("secret-token") {
		t.Fatal("同令牌哈希不稳定")
	}
	if a == HashToken("other-token") {
		t.Fatal("不同令牌哈希相同")
	}
}
