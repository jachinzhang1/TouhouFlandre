package server_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
)

type playerLimitRoom struct {
	roomID    string
	roomCode  string
	hostToken string
}

func createPlayerLimitRoom(t *testing.T, body map[string]any) playerLimitRoom {
	t.Helper()
	resp, payload := fastRequest(http.MethodPost, "/api/rooms", body)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create player-limit room: %d %s", resp.StatusCode, payload)
	}
	var created openapi.CreateRoomResponse
	if err := json.Unmarshal(payload, &created); err != nil {
		t.Fatal(err)
	}
	return playerLimitRoom{roomID: created.RoomId, roomCode: created.RoomCode, hostToken: string(created.GuestToken)}
}

func roomPlayerLimit(t *testing.T, roomCode string) int {
	t.Helper()
	resp, payload := fastRequest(http.MethodGet, "/api/rooms/"+roomCode, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get room info: %d %s", resp.StatusCode, payload)
	}
	var info openapi.RoomInfo
	if err := json.Unmarshal(payload, &info); err != nil {
		t.Fatal(err)
	}
	return info.PlayerLimit
}

func requirePlayerLimitError(t *testing.T, status int, code string, resp *http.Response, payload []byte) {
	t.Helper()
	if resp.StatusCode != status {
		t.Fatalf("status = %d, want %d: %s", resp.StatusCode, status, payload)
	}
	if apiErr := decodeError(t, payload); string(apiErr.Code) != code {
		t.Fatalf("error code = %s, want %s: %s", apiErr.Code, code, payload)
	}
}

func TestMultiRacePlayerLimitCreateValidation(t *testing.T) {
	defaultRoom := createPlayerLimitRoom(t, map[string]any{"format": "bo1", "mode": "race"})
	if got := roomPlayerLimit(t, defaultRoom.roomCode); got != 2 {
		t.Fatalf("default race playerLimit = %d, want 2", got)
	}

	for limit := 2; limit <= 8; limit++ {
		room := createPlayerLimitRoom(t, map[string]any{"format": "bo1", "mode": "race", "playerLimit": limit})
		if got := roomPlayerLimit(t, room.roomCode); got != limit {
			t.Fatalf("created race playerLimit = %d, want %d", got, limit)
		}
	}

	for _, limit := range []int{1, 9} {
		resp, payload := fastRequest(http.MethodPost, "/api/rooms", map[string]any{"format": "bo1", "mode": "race", "playerLimit": limit})
		requirePlayerLimitError(t, http.StatusBadRequest, "INVALID_PLAYER_LIMIT", resp, payload)
	}

	relay := createPlayerLimitRoom(t, map[string]any{"format": "bo1", "mode": "relay"})
	if got := roomPlayerLimit(t, relay.roomCode); got != 2 {
		t.Fatalf("relay playerLimit = %d, want 2", got)
	}
	resp, payload := fastRequest(http.MethodPost, "/api/rooms", map[string]any{"format": "bo1", "mode": "relay", "playerLimit": 2})
	requirePlayerLimitError(t, http.StatusBadRequest, "INVALID_PLAYER_LIMIT", resp, payload)
}

func TestMultiRacePlayerLimitHostAuthorizationAndLocking(t *testing.T) {
	room := createPlayerLimitRoom(t, map[string]any{"format": "bo1", "mode": "race"})
	resp, payload := fastRequest(http.MethodPost, "/api/rooms/"+room.roomCode+"/join", map[string]any{})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("join second player: %d %s", resp.StatusCode, payload)
	}
	var second openapi.JoinRoomResponse
	if err := json.Unmarshal(payload, &second); err != nil {
		t.Fatal(err)
	}

	resp, payload = fastRequest(http.MethodPost, "/api/rooms/"+room.roomCode+"/join", map[string]any{})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("join spectator: %d %s", resp.StatusCode, payload)
	}
	var spectator openapi.JoinRoomResponse
	if err := json.Unmarshal(payload, &spectator); err != nil {
		t.Fatal(err)
	}
	if spectator.JoinRole != openapi.ParticipantRoleSpectator {
		t.Fatalf("third participant role = %s, want spectator", spectator.JoinRole)
	}

	settingsPath := "/api/rooms/" + room.roomID + "/settings"
	resp, payload = fastRequestAuth(http.MethodPatch, settingsPath, string(second.GuestToken), map[string]int{"playerLimit": 3})
	requirePlayerLimitError(t, http.StatusForbidden, "GUEST_UNAUTHORIZED", resp, payload)
	resp, payload = fastRequestAuth(http.MethodPatch, settingsPath, string(spectator.GuestToken), map[string]int{"playerLimit": 3})
	requirePlayerLimitError(t, http.StatusForbidden, "SPECTATOR_READ_ONLY", resp, payload)

	for _, limit := range []int{3, 4, 5, 6, 7, 8, 2} {
		resp, payload = fastRequestAuth(http.MethodPatch, settingsPath, room.hostToken, map[string]int{"playerLimit": limit})
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("set playerLimit %d: %d %s", limit, resp.StatusCode, payload)
		}
		if got := roomPlayerLimit(t, room.roomCode); got != limit {
			t.Fatalf("updated playerLimit = %d, want %d", got, limit)
		}
	}

	resp, payload = fastRequestAuth(http.MethodPatch, settingsPath, room.hostToken, map[string]any{})
	requirePlayerLimitError(t, http.StatusBadRequest, "INVALID_REQUEST", resp, payload)
	for _, limit := range []int{1, 9} {
		resp, payload = fastRequestAuth(http.MethodPatch, settingsPath, room.hostToken, map[string]int{"playerLimit": limit})
		requirePlayerLimitError(t, http.StatusBadRequest, "INVALID_PLAYER_LIMIT", resp, payload)
	}

	resp, payload = fastRequestAuth(http.MethodPatch, settingsPath, room.hostToken, map[string]int{"playerLimit": 3})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("raise playerLimit for third player: %d %s", resp.StatusCode, payload)
	}
	resp, payload = fastRequest(http.MethodPost, "/api/rooms/"+room.roomCode+"/join", map[string]any{})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("join third player: %d %s", resp.StatusCode, payload)
	}
	var third openapi.JoinRoomResponse
	if err := json.Unmarshal(payload, &third); err != nil {
		t.Fatal(err)
	}
	if third.JoinRole != openapi.ParticipantRolePlayer {
		t.Fatalf("new participant role = %s, want player", third.JoinRole)
	}
	resp, payload = fastRequestAuth(http.MethodPatch, settingsPath, room.hostToken, map[string]int{"playerLimit": 2})
	requirePlayerLimitError(t, http.StatusBadRequest, "INVALID_PLAYER_LIMIT", resp, payload)

	readyPath := "/api/rooms/" + room.roomID + "/ready"
	resp, payload = fastRequestAuth(http.MethodPost, readyPath, room.hostToken, map[string]bool{"ready": true})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("host ready: %d %s", resp.StatusCode, payload)
	}
	resp, payload = fastRequestAuth(http.MethodPatch, settingsPath, room.hostToken, map[string]int{"playerLimit": 4})
	requirePlayerLimitError(t, http.StatusConflict, "ROOM_SETTINGS_LOCKED", resp, payload)
	resp, payload = fastRequestAuth(http.MethodPost, readyPath, room.hostToken, map[string]bool{"ready": false})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("host unready: %d %s", resp.StatusCode, payload)
	}
	resp, payload = fastRequestAuth(http.MethodPatch, settingsPath, room.hostToken, map[string]int{"playerLimit": 4})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("settings after all unready: %d %s", resp.StatusCode, payload)
	}

	resp, payload = fastRequestAuth(http.MethodPost, readyPath, string(second.GuestToken), map[string]bool{"ready": true})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("second ready: %d %s", resp.StatusCode, payload)
	}
	resp, payload = fastRequestAuth(http.MethodPatch, settingsPath, room.hostToken, map[string]int{"playerLimit": 5})
	requirePlayerLimitError(t, http.StatusConflict, "ROOM_SETTINGS_LOCKED", resp, payload)
	resp, payload = fastRequestAuth(http.MethodPost, readyPath, string(second.GuestToken), map[string]bool{"ready": false})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("second unready: %d %s", resp.StatusCode, payload)
	}
	resp, payload = fastRequestAuth(http.MethodPatch, settingsPath, room.hostToken, map[string]int{"playerLimit": 5})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("settings restored after second unready: %d %s", resp.StatusCode, payload)
	}

	for label, token := range map[string]string{
		"second": string(second.GuestToken),
		"third":  string(third.GuestToken),
		"host":   room.hostToken,
	} {
		resp, payload = fastRequestAuth(http.MethodPost, readyPath, token, map[string]bool{"ready": true})
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("%s final ready: %d %s", label, resp.StatusCode, payload)
		}
	}
	resp, payload = fastRequestAuth(http.MethodPatch, settingsPath, room.hostToken, map[string]int{"playerLimit": 6})
	requirePlayerLimitError(t, http.StatusConflict, "ROOM_SETTINGS_LOCKED", resp, payload)
}

func TestMultiRelayRejectsPlayerLimitSettings(t *testing.T) {
	room := createPlayerLimitRoom(t, map[string]any{"format": "bo1", "mode": "relay"})
	resp, payload := fastRequestAuth(http.MethodPatch, "/api/rooms/"+room.roomID+"/settings", room.hostToken, map[string]int{"playerLimit": 2})
	requirePlayerLimitError(t, http.StatusBadRequest, "INVALID_PLAYER_LIMIT", resp, payload)
}
