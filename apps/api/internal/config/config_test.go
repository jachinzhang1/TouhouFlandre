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
	t.Setenv("MULTI_SYSTEM_ANNOUNCEMENTS_ENABLED", "")
	if !MultiNPlayerRaceEnabled() {
		t.Fatal("N-player race rollout should default to enabled")
	}
	if !MultiChatSendEnabled() {
		t.Fatal("chat send rollout should default to enabled")
	}
	if !MultiSystemAnnouncementsEnabled() {
		t.Fatal("system announcements should default to enabled")
	}
}

func TestMultiRolloutFlagsParseBooleanValues(t *testing.T) {
	t.Setenv("MULTI_N_PLAYER_RACE_ENABLED", "on")
	t.Setenv("MULTI_CHAT_SEND_ENABLED", "0")
	t.Setenv("MULTI_SYSTEM_ANNOUNCEMENTS_ENABLED", "off")
	if !MultiNPlayerRaceEnabled() {
		t.Fatal("N-player race rollout should parse on as enabled")
	}
	if MultiChatSendEnabled() {
		t.Fatal("chat send rollout should parse 0 as disabled")
	}
	if MultiSystemAnnouncementsEnabled() {
		t.Fatal("system announcements should parse off as disabled")
	}
}

func TestRelayRolloutAndRegistryDefaultsAreOpenAndFull(t *testing.T) {
	t.Setenv("MULTI_N_PLAYER_RELAY_ENABLED", "")
	t.Setenv("MULTI_RELAY_ELIMINATION_ENABLED", "")
	t.Setenv("MULTI_MODE_REGISTRY", "")
	t.Setenv("MULTI_RELAY_HISTORY_RATE_LIMIT", "")
	if !MultiNPlayerRelayEnabled() {
		t.Fatal("N-player relay rollout must default open")
	}
	if !MultiRelayEliminationEnabled() {
		t.Fatal("relay elimination rollout must default open")
	}
	t.Setenv("MULTI_N_PLAYER_RELAY_ENABLED", "false")
	t.Setenv("MULTI_RELAY_ELIMINATION_ENABLED", "false")
	if MultiNPlayerRelayEnabled() || MultiRelayEliminationEnabled() {
		t.Fatal("relay rollout flags must honor explicit false")
	}
	if got := MultiModeRegistry(); got != "full" {
		t.Fatalf("registry profile=%q, want full", got)
	}
	if got := MultiRelayHistoryRateLimit(); got != 60 {
		t.Fatalf("history rate limit=%d, want 60", got)
	}
}

func TestRegistryProfileIsNormalizedAndHistoryLimitValidated(t *testing.T) {
	t.Setenv("MULTI_MODE_REGISTRY", " Relay-Only ")
	t.Setenv("MULTI_RELAY_HISTORY_RATE_LIMIT", "17")
	if got := MultiModeRegistry(); got != "relay-only" {
		t.Fatalf("registry profile=%q", got)
	}
	if got := MultiRelayHistoryRateLimit(); got != 17 {
		t.Fatalf("history rate limit=%d", got)
	}
}
