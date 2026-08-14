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

func TestMultiRolloutFlagsDefaultOpen(t *testing.T) {
	t.Setenv("MULTI_N_PLAYER_RACE_ENABLED", "")
	t.Setenv("MULTI_CHAT_SEND_ENABLED", "")
	if !MultiNPlayerRaceEnabled() {
		t.Fatal("N-player race rollout should default to enabled")
	}
	if !MultiChatSendEnabled() {
		t.Fatal("chat send rollout should default to enabled")
	}
}

func TestMultiRolloutFlagsParseBooleanValues(t *testing.T) {
	t.Setenv("MULTI_N_PLAYER_RACE_ENABLED", "on")
	t.Setenv("MULTI_CHAT_SEND_ENABLED", "0")
	if !MultiNPlayerRaceEnabled() {
		t.Fatal("N-player race rollout should parse on as enabled")
	}
	if MultiChatSendEnabled() {
		t.Fatal("chat send rollout should parse 0 as disabled")
	}
}
