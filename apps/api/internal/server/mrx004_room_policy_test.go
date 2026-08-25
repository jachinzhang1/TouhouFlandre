package server_test

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
)

type relayPolicyFixture struct {
	roomID string
	code   string
	tokens []string
}

func createRelayPolicyFixture(t *testing.T, limit int, elimination bool, players int) relayPolicyFixture {
	t.Helper()
	resp, payload := fastRequest(http.MethodPost, "/api/rooms", map[string]any{
		"format": "bo1", "mode": "relay", "playerLimit": limit,
		"relayEliminationEnabled": elimination,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create relay room: %d %s", resp.StatusCode, payload)
	}
	var created openapi.CreateRoomResponse
	if err := json.Unmarshal(payload, &created); err != nil {
		t.Fatal(err)
	}
	fixture := relayPolicyFixture{roomID: created.RoomId, code: created.RoomCode, tokens: []string{string(created.GuestToken)}}
	for range players - 1 {
		resp, payload = fastRequest(http.MethodPost, "/api/rooms/"+fixture.code+"/join", map[string]string{})
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("join relay player: %d %s", resp.StatusCode, payload)
		}
		var joined openapi.JoinRoomResponse
		if err := json.Unmarshal(payload, &joined); err != nil {
			t.Fatal(err)
		}
		if joined.JoinRole != openapi.ParticipantRolePlayer {
			t.Fatalf("relay join role = %s, want player", joined.JoinRole)
		}
		fixture.tokens = append(fixture.tokens, string(joined.GuestToken))
	}
	return fixture
}

func setRelayReady(t *testing.T, fixture relayPolicyFixture) {
	t.Helper()
	for _, token := range fixture.tokens {
		resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/ready", token, map[string]bool{"ready": true})
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("relay ready: %d %s", resp.StatusCode, payload)
		}
	}
}

func TestMRX004RelayCapacityAndModeFieldValidation(t *testing.T) {
	for _, limit := range []int{2, 4, 6, 8} {
		fixture := createRelayPolicyFixture(t, limit, false, 1)
		resp, payload := fastRequest(http.MethodGet, "/api/rooms/"+fixture.code, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("relay info %d: %d %s", limit, resp.StatusCode, payload)
		}
		var info openapi.RoomInfo
		if err := json.Unmarshal(payload, &info); err != nil {
			t.Fatal(err)
		}
		if info.PlayerLimit != limit || info.RelayEliminationEnabled == nil || *info.RelayEliminationEnabled {
			t.Fatalf("relay info = %+v", info)
		}
	}
	for _, limit := range []int{0, 1, 3, 5, 7, 9, 10} {
		resp, payload := fastRequest(http.MethodPost, "/api/rooms", map[string]any{"format": "bo1", "mode": "relay", "playerLimit": limit})
		requirePlayerLimitError(t, http.StatusBadRequest, "INVALID_PLAYER_LIMIT", resp, payload)
	}
	resp, payload := fastRequest(http.MethodPost, "/api/rooms", map[string]any{
		"format": "bo1", "mode": "relay", "raceEliminationEnabled": true, "relayEliminationEnabled": true,
	})
	if resp.StatusCode != http.StatusBadRequest || decodeError(t, payload).Code != "INVALID_REQUEST" {
		t.Fatalf("mixed create fields: %d %s", resp.StatusCode, payload)
	}
}

func TestMRX004RelayOddRosterBlocksAndEvenRosterStarts(t *testing.T) {
	fixture := createRelayPolicyFixture(t, 6, false, 3)
	setRelayReady(t, fixture)
	time.Sleep(10 * time.Millisecond)
	if err := fastSweeper().SweepOnce(ctx); err != nil {
		t.Fatal(err)
	}
	resp, payload := fastRequest(http.MethodGet, "/api/rooms/"+fixture.code, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("odd relay info: %d %s", resp.StatusCode, payload)
	}
	var oddInfo openapi.RoomInfo
	if err := json.Unmarshal(payload, &oddInfo); err != nil {
		t.Fatal(err)
	}
	if oddInfo.Status != openapi.RoomStatusLobby || oddInfo.StartBlockedReason == nil || string(*oddInfo.StartBlockedReason) != "odd_player_count" {
		t.Fatalf("odd relay projection = %+v", oddInfo)
	}

	resp, payload = fastRequest(http.MethodPost, "/api/rooms/"+fixture.code+"/join", map[string]string{})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("fourth relay join: %d %s", resp.StatusCode, payload)
	}
	var joined openapi.JoinRoomResponse
	if err := json.Unmarshal(payload, &joined); err != nil {
		t.Fatal(err)
	}
	fixture.tokens = append(fixture.tokens, string(joined.GuestToken))
	resp, payload = fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/ready", fixture.tokens[3], map[string]bool{"ready": true})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("fourth relay ready: %d %s", resp.StatusCode, payload)
	}
	resp, payload = fastRequestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/snapshot", fixture.tokens[0], nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("even relay snapshot: %d %s", resp.StatusCode, payload)
	}
	var snapshot openapi.RoomSnapshot
	if err := json.Unmarshal(payload, &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Match == nil || snapshot.Match.RuleSetRef.Key != "fixed_points" {
		t.Fatalf("even relay match = %+v", snapshot.Match)
	}
}

func TestMRX004RelayTwoPlayersFreezeLegacyRegardlessOfToggle(t *testing.T) {
	for _, elimination := range []bool{false, true} {
		fixture := createRelayPolicyFixture(t, 4, elimination, 2)
		setRelayReady(t, fixture)
		resp, payload := fastRequestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/snapshot", fixture.tokens[0], nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("two-player relay snapshot: %d %s", resp.StatusCode, payload)
		}
		var snapshot openapi.RoomSnapshot
		if err := json.Unmarshal(payload, &snapshot); err != nil {
			t.Fatal(err)
		}
		if snapshot.Match == nil || snapshot.Match.RuleSetRef.Key != "legacy_wins" {
			t.Fatalf("two-player relay toggle=%t match = %+v", elimination, snapshot.Match)
		}
	}
}
