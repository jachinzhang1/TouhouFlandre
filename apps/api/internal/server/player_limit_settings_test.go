package server_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/coder/websocket"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
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

func playerLimitEventPayload(t *testing.T, conn *websocket.Conn, wantLimit int) (map[string]any, int64) {
	t.Helper()
	for range 8 {
		frame := wsRead(t, conn)
		if frame["type"] != "room.updated" {
			continue
		}
		payload, ok := frame["payload"].(map[string]any)
		if !ok {
			t.Fatalf("room.updated payload = %#v", frame["payload"])
		}
		limit, ok := payload["playerLimit"].(float64)
		if !ok || int(limit) != wantLimit {
			continue
		}
		sequence, ok := frame["sequence"].(float64)
		if !ok {
			t.Fatalf("room.updated sequence = %#v", frame["sequence"])
		}
		return payload, int64(sequence)
	}
	t.Fatalf("未收到 playerLimit=%d 的 room.updated", wantLimit)
	return nil, 0
}

func requirePlayerLimitPayload(t *testing.T, payload map[string]any, limit, players, spectators int) {
	t.Helper()
	wants := map[string]int{
		"playerLimit":    limit,
		"minPlayers":     2,
		"playerCount":    players,
		"availableSeats": limit - players,
		"spectatorCount": spectators,
	}
	for field, want := range wants {
		got, ok := payload[field].(float64)
		if !ok || int(got) != want {
			t.Fatalf("room.updated %s = %#v, want %d (payload=%v)", field, payload[field], want, payload)
		}
	}
}

func roomCapacityEvent(t *testing.T, conn *websocket.Conn, limit, players, spectators int) (map[string]any, int64) {
	t.Helper()
	for range 16 {
		frame := wsRead(t, conn)
		if frame["type"] != "room.updated" {
			continue
		}
		payload, ok := frame["payload"].(map[string]any)
		if !ok {
			continue
		}
		gotLimit, limitOK := payload["playerLimit"].(float64)
		gotPlayers, playersOK := payload["playerCount"].(float64)
		gotSpectators, spectatorsOK := payload["spectatorCount"].(float64)
		if !limitOK || !playersOK || !spectatorsOK || int(gotLimit) != limit || int(gotPlayers) != players || int(gotSpectators) != spectators {
			continue
		}
		sequence, ok := frame["sequence"].(float64)
		if !ok {
			t.Fatalf("room.updated sequence = %#v", frame["sequence"])
		}
		return payload, int64(sequence)
	}
	t.Fatalf("未收到 limit=%d players=%d spectators=%d 的 room.updated", limit, players, spectators)
	return nil, 0
}

func TestMultiRacePlayerLimitBroadcastSnapshotAndReconnect(t *testing.T) {
	room := createPlayerLimitRoom(t, map[string]any{"format": "bo1", "mode": "race"})
	resp, payload := fastRequest(http.MethodPost, "/api/rooms/"+room.roomCode+"/join", map[string]any{})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("join second player: %d %s", resp.StatusCode, payload)
	}
	resp, payload = fastRequest(http.MethodPost, "/api/rooms/"+room.roomCode+"/join", map[string]any{})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("join spectator: %d %s", resp.StatusCode, payload)
	}
	var spectator openapi.JoinRoomResponse
	if err := json.Unmarshal(payload, &spectator); err != nil {
		t.Fatal(err)
	}

	hostConn := wsDial(t, room.roomID, room.hostToken, 0, nil)
	spectatorConn := wsDial(t, room.roomID, string(spectator.GuestToken), 0, nil)
	drainUntilType(t, hostConn, "sync.complete", 16)
	drainUntilType(t, spectatorConn, "sync.complete", 16)

	settingsPath := "/api/rooms/" + room.roomID + "/settings"
	resp, payload = fastRequestAuth(http.MethodPatch, settingsPath, room.hostToken, map[string]int{"playerLimit": 4})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("update settings: %d %s", resp.StatusCode, payload)
	}
	hostEvent, hostSequence := playerLimitEventPayload(t, hostConn, 4)
	spectatorEvent, spectatorSequence := playerLimitEventPayload(t, spectatorConn, 4)
	requirePlayerLimitPayload(t, hostEvent, 4, 2, 1)
	requirePlayerLimitPayload(t, spectatorEvent, 4, 2, 1)
	if hostSequence != spectatorSequence {
		t.Fatalf("broadcast sequences differ: host=%d spectator=%d", hostSequence, spectatorSequence)
	}

	snapshotResp, snapshotPayload := fastRequestAuth(http.MethodGet, "/api/rooms/"+room.roomID+"/snapshot", room.hostToken, nil)
	if snapshotResp.StatusCode != http.StatusOK {
		t.Fatalf("snapshot: %d %s", snapshotResp.StatusCode, snapshotPayload)
	}
	var snapshot openapi.RoomSnapshot
	if err := json.Unmarshal(snapshotPayload, &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.PlayerLimit != 4 || snapshot.MinPlayers != 2 || snapshot.PlayerCount != 2 || snapshot.AvailableSeats != 2 || snapshot.SpectatorCount != 1 {
		t.Fatalf("snapshot capacity = limit:%d min:%d players:%d seats:%d spectators:%d", snapshot.PlayerLimit, snapshot.MinPlayers, snapshot.PlayerCount, snapshot.AvailableSeats, snapshot.SpectatorCount)
	}

	reconnected := wsDial(t, room.roomID, string(spectator.GuestToken), hostSequence-1, nil)
	if hello := wsRead(t, reconnected); hello["type"] != "hello-ok" {
		t.Fatalf("reconnect hello = %v", hello)
	}
	replayed, replaySequence := playerLimitEventPayload(t, reconnected, 4)
	requirePlayerLimitPayload(t, replayed, 4, 2, 1)
	if replaySequence != hostSequence {
		t.Fatalf("replayed sequence = %d, want %d", replaySequence, hostSequence)
	}
	drainUntilType(t, reconnected, "sync.complete", 4)

	before, err := repo.New(pool).GetRoom(ctx, room.roomID)
	if err != nil {
		t.Fatal(err)
	}
	resp, payload = fastRequestAuth(http.MethodPatch, settingsPath, room.hostToken, map[string]int{"playerLimit": 4})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("idempotent settings: %d %s", resp.StatusCode, payload)
	}
	after, err := repo.New(pool).GetRoom(ctx, room.roomID)
	if err != nil {
		t.Fatal(err)
	}
	if after.EventSeq != before.EventSeq {
		t.Fatalf("idempotent setting emitted event: before=%d after=%d", before.EventSeq, after.EventSeq)
	}
}

func TestMultiRacePlayerLimitKeepsSpectatorsExplicitAndAuthoritative(t *testing.T) {
	room := createPlayerLimitRoom(t, map[string]any{"format": "bo1", "mode": "race"})
	join := func() openapi.JoinRoomResponse {
		t.Helper()
		resp, payload := fastRequest(http.MethodPost, "/api/rooms/"+room.roomCode+"/join", map[string]any{})
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("join: %d %s", resp.StatusCode, payload)
		}
		var participant openapi.JoinRoomResponse
		if err := json.Unmarshal(payload, &participant); err != nil {
			t.Fatal(err)
		}
		return participant
	}
	second := join()
	if second.JoinRole != openapi.ParticipantRolePlayer {
		t.Fatalf("second role = %s", second.JoinRole)
	}
	claimant := join()
	observer := join()
	if claimant.JoinRole != openapi.ParticipantRoleSpectator || observer.JoinRole != openapi.ParticipantRoleSpectator {
		t.Fatalf("initial spectator roles = %s/%s", claimant.JoinRole, observer.JoinRole)
	}

	observerConn := wsDial(t, room.roomID, string(observer.GuestToken), 0, nil)
	drainUntilType(t, observerConn, "sync.complete", 20)
	settingsPath := "/api/rooms/" + room.roomID + "/settings"
	resp, payload := fastRequestAuth(http.MethodPatch, settingsPath, room.hostToken, map[string]int{"playerLimit": 4})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("expand to four: %d %s", resp.StatusCode, payload)
	}
	expanded, _ := roomCapacityEvent(t, observerConn, 4, 2, 2)
	requirePlayerLimitPayload(t, expanded, 4, 2, 2)

	var claimantRole, observerRole string
	if err := pool.QueryRow(ctx, `SELECT role FROM multi_member WHERE id = $1`, claimant.Viewer.MemberId).Scan(&claimantRole); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT role FROM multi_member WHERE id = $1`, observer.Viewer.MemberId).Scan(&observerRole); err != nil {
		t.Fatal(err)
	}
	if claimantRole != "spectator" || observerRole != "spectator" {
		t.Fatalf("expansion auto-promoted spectators: claimant=%s observer=%s", claimantRole, observerRole)
	}

	resp, payload = fastRequestAuth(http.MethodPost, "/api/rooms/"+room.roomID+"/claim-seat", string(claimant.GuestToken), nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("explicit claim: %d %s", resp.StatusCode, payload)
	}
	claimed, _ := roomCapacityEvent(t, observerConn, 4, 3, 1)
	requirePlayerLimitPayload(t, claimed, 4, 3, 1)
	var claimedRole string
	var claimedSeat int
	if err := pool.QueryRow(ctx, `SELECT role, seat FROM multi_member WHERE id = $1`, claimant.Viewer.MemberId).Scan(&claimedRole, &claimedSeat); err != nil {
		t.Fatal(err)
	}
	if claimedRole != "player" || claimedSeat != 3 {
		t.Fatalf("claimed identity role=%s seat=%d, want player/3", claimedRole, claimedSeat)
	}

	resp, payload = fastRequestAuth(http.MethodPatch, settingsPath, room.hostToken, map[string]int{"playerLimit": 3})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("shrink to occupied capacity: %d %s", resp.StatusCode, payload)
	}
	shrunk, _ := roomCapacityEvent(t, observerConn, 3, 3, 1)
	requirePlayerLimitPayload(t, shrunk, 3, 3, 1)
	resp, payload = fastRequestAuth(http.MethodPost, "/api/rooms/"+room.roomID+"/claim-seat", string(observer.GuestToken), nil)
	requirePlayerLimitError(t, http.StatusConflict, "ROOM_FULL", resp, payload)

	resp, payload = fastRequestAuth(http.MethodPatch, settingsPath, room.hostToken, map[string]int{"playerLimit": 4})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("re-expand: %d %s", resp.StatusCode, payload)
	}
	roomCapacityEvent(t, observerConn, 4, 3, 1)
	competitor := join()
	if competitor.JoinRole != openapi.ParticipantRolePlayer || competitor.Viewer.Seat == nil || *competitor.Viewer.Seat != 4 {
		t.Fatalf("competitor = %+v, want player seat 4", competitor)
	}
	occupied, _ := roomCapacityEvent(t, observerConn, 4, 4, 1)
	requirePlayerLimitPayload(t, occupied, 4, 4, 1)
	resp, payload = fastRequestAuth(http.MethodPost, "/api/rooms/"+room.roomID+"/claim-seat", string(observer.GuestToken), nil)
	requirePlayerLimitError(t, http.StatusConflict, "ROOM_FULL", resp, payload)

	snapshotResp, snapshotPayload := fastRequestAuth(http.MethodGet, "/api/rooms/"+room.roomID+"/snapshot", string(observer.GuestToken), nil)
	if snapshotResp.StatusCode != http.StatusOK {
		t.Fatalf("spectator snapshot: %d %s", snapshotResp.StatusCode, snapshotPayload)
	}
	var snapshot openapi.RoomSnapshot
	if err := json.Unmarshal(snapshotPayload, &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Viewer.Role != openapi.ParticipantRoleSpectator || snapshot.PlayerLimit != 4 || snapshot.PlayerCount != 4 || snapshot.AvailableSeats != 0 || snapshot.SpectatorCount != 1 {
		t.Fatalf("authoritative snapshot = %+v", snapshot)
	}
	foundClaimant := false
	for _, member := range snapshot.Members {
		if member.MemberId == claimant.Viewer.MemberId {
			foundClaimant = member.Seat == 3
		}
		if member.MemberId == observer.Viewer.MemberId {
			t.Fatal("observer was auto-promoted after capacity changes")
		}
	}
	if !foundClaimant {
		t.Fatal("explicit claimant identity/seat missing from snapshot")
	}
}
