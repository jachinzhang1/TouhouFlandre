package config

import (
	"bytes"
	"testing"
)

func TestMultiProjectionSecretUsesConfiguredValue(t *testing.T) {
	t.Setenv("MULTI_PROJECTION_SECRET", "configured-projection-secret")
	secret := MultiProjectionSecret()
	secret[0] = 'X'
	if got := string(MultiProjectionSecret()); got != "configured-projection-secret" {
		t.Fatalf("configured projection secret = %q", got)
	}
}

func TestMultiProjectionSecretFallbackIsProcessStableAndPrivate(t *testing.T) {
	t.Setenv("MULTI_PROJECTION_SECRET", "")
	first := MultiProjectionSecret()
	second := MultiProjectionSecret()
	if len(first) != 32 || !bytes.Equal(first, second) {
		t.Fatalf("fallback secrets len=%d/%d equal=%t", len(first), len(second), bytes.Equal(first, second))
	}
	first[0] ^= 0xff
	if bytes.Equal(first, MultiProjectionSecret()) {
		t.Fatal("caller mutated process projection secret")
	}
}
