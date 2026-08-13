package server_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"testing"

	"github.com/coder/websocket"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
)

type playerLimitRoom struct {
	roomID       string
	roomCode     string
	hostToken    string
	hostMemberID string
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
	return playerLimitRoom{roomID: created.RoomId, roomCode: created.RoomCode, hostToken: string(created.GuestToken), hostMemberID: created.Viewer.MemberId}
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

func TestMultiRacePlayerLimitConcurrentJoinBoundary(t *testing.T) {
	for _, limit := range []int{2, 4, 8} {
		limit := limit
		t.Run(fmt.Sprintf("limit_%d", limit), func(t *testing.T) {
			room := createPlayerLimitRoom(t, map[string]any{"format": "bo1", "mode": "race", "playerLimit": limit})
			attempts := limit + 5
			start := make(chan struct{})
			results := make(chan lifecycleParticipantResponse, attempts)
			var wg sync.WaitGroup
			for range attempts {
				wg.Add(1)
				go func() {
					defer wg.Done()
					<-start
					resp, payload := fastRequest(http.MethodPost, "/api/rooms/"+room.roomCode+"/join", map[string]any{})
					results <- lifecycleParticipantResponse{response: lifecycleResponse{status: resp.StatusCode, payload: payload}}
				}()
			}
			close(start)
			wg.Wait()
			close(results)

			playerResponses := 0
			spectatorResponses := 0
			for result := range results {
				if result.response.status != http.StatusCreated {
					t.Fatalf("concurrent join = %d %s", result.response.status, result.response.payload)
				}
				var participant openapi.JoinRoomResponse
				if err := json.Unmarshal(result.response.payload, &participant); err != nil {
					t.Fatal(err)
				}
				switch participant.JoinRole {
				case openapi.ParticipantRolePlayer:
					playerResponses++
				case openapi.ParticipantRoleSpectator:
					spectatorResponses++
				default:
					t.Fatalf("unexpected joinRole %s", participant.JoinRole)
				}
			}
			if playerResponses != limit-1 || spectatorResponses != attempts-(limit-1) {
				t.Fatalf("response roles players=%d spectators=%d, want %d/%d", playerResponses, spectatorResponses, limit-1, attempts-(limit-1))
			}

			var playerCount, spectatorCount, uniqueSeats, maxSeat int
			if err := pool.QueryRow(ctx, `
				SELECT
					count(*) FILTER (WHERE role = 'player')::int,
					count(*) FILTER (WHERE role = 'spectator' AND status <> 'left')::int,
					count(DISTINCT seat) FILTER (WHERE role = 'player')::int,
					COALESCE(max(seat) FILTER (WHERE role = 'player'), 0)::int
				FROM multi_member WHERE room_id = $1`, room.roomID).Scan(&playerCount, &spectatorCount, &uniqueSeats, &maxSeat); err != nil {
				t.Fatal(err)
			}
			if playerCount != limit || uniqueSeats != limit || maxSeat != limit || spectatorCount != spectatorResponses {
				t.Fatalf("database boundary players=%d uniqueSeats=%d maxSeat=%d spectators=%d, want %d/%d/%d/%d", playerCount, uniqueSeats, maxSeat, spectatorCount, limit, limit, limit, spectatorResponses)
			}
		})
	}
}

func latestPlayerLimitRoomUpdated(t *testing.T, roomID string) multi.RoomUpdatedPayload {
	t.Helper()
	var raw []byte
	if err := pool.QueryRow(ctx, `
		SELECT payload FROM room_event
		WHERE room_id = $1 AND type = 'room.updated'
		ORDER BY sequence DESC LIMIT 1`, roomID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var payload multi.RoomUpdatedPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
	return payload
}

func playerLimitTerminalCapacity(t *testing.T, roomID string) (limit, players, spectators, overLimit, matches int, status string) {
	t.Helper()
	if err := pool.QueryRow(ctx, `
		SELECT r.player_limit, r.status,
		       count(*) FILTER (WHERE m.role = 'player')::int,
		       count(*) FILTER (WHERE m.role = 'spectator' AND m.status <> 'left')::int,
		       count(*) FILTER (WHERE m.role = 'player' AND m.seat > r.player_limit)::int,
		       (SELECT count(*) FROM multi_match mm WHERE mm.room_id = r.id)::int
		FROM multi_room r
		LEFT JOIN multi_member m ON m.room_id = r.id
		WHERE r.id = $1
		GROUP BY r.id`, roomID).Scan(&limit, &status, &players, &spectators, &overLimit, &matches); err != nil {
		t.Fatal(err)
	}
	return
}

func requireTerminalEventCapacity(t *testing.T, roomID string, limit, players, spectators int) {
	t.Helper()
	payload := latestPlayerLimitRoomUpdated(t, roomID)
	if payload.PlayerLimit != limit || payload.PlayerCount != players || payload.AvailableSeats != limit-players || payload.SpectatorCount != spectators || len(payload.Members) != players {
		t.Fatalf("terminal room.updated = %+v, want limit=%d players=%d spectators=%d", payload, limit, players, spectators)
	}
}

func TestMultiRacePlayerLimitSettingsVsJoinLinearizes(t *testing.T) {
	for iteration := 0; iteration < 8; iteration++ {
		room := createPlayerLimitRoom(t, map[string]any{"format": "bo1", "mode": "race", "playerLimit": 3})
		secondResp, secondPayload := fastRequest(http.MethodPost, "/api/rooms/"+room.roomCode+"/join", map[string]any{})
		if secondResp.StatusCode != http.StatusCreated {
			t.Fatalf("join second: %d %s", secondResp.StatusCode, secondPayload)
		}

		start := make(chan struct{})
		settingsResult := make(chan lifecycleResponse, 1)
		joinResult := make(chan lifecycleResponse, 1)
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			resp, payload := fastRequestAuth(http.MethodPatch, "/api/rooms/"+room.roomID+"/settings", room.hostToken, map[string]int{"playerLimit": 2})
			settingsResult <- lifecycleResponse{status: resp.StatusCode, payload: payload}
		}()
		go func() {
			defer wg.Done()
			<-start
			resp, payload := fastRequest(http.MethodPost, "/api/rooms/"+room.roomCode+"/join", map[string]any{})
			joinResult <- lifecycleResponse{status: resp.StatusCode, payload: payload}
		}()
		close(start)
		wg.Wait()
		settings := <-settingsResult
		joined := <-joinResult
		if joined.status != http.StatusCreated {
			t.Fatalf("concurrent join: %d %s", joined.status, joined.payload)
		}
		var participant openapi.JoinRoomResponse
		if err := json.Unmarshal(joined.payload, &participant); err != nil {
			t.Fatal(err)
		}
		limit, players, spectators, overLimit, matches, status := playerLimitTerminalCapacity(t, room.roomID)
		if overLimit != 0 || matches != 0 || status != string(multi.RoomStatusLobby) {
			t.Fatalf("terminal invariant status=%s overLimit=%d matches=%d", status, overLimit, matches)
		}
		switch settings.status {
		case http.StatusNoContent:
			if participant.JoinRole != openapi.ParticipantRoleSpectator || limit != 2 || players != 2 || spectators != 1 {
				t.Fatalf("settings-first role=%s limit=%d players=%d spectators=%d", participant.JoinRole, limit, players, spectators)
			}
		case http.StatusBadRequest:
			if code := decodeError(t, settings.payload).Code; code != "INVALID_PLAYER_LIMIT" {
				t.Fatalf("join-first settings error = %s", code)
			}
			if participant.JoinRole != openapi.ParticipantRolePlayer || limit != 3 || players != 3 || spectators != 0 {
				t.Fatalf("join-first role=%s limit=%d players=%d spectators=%d", participant.JoinRole, limit, players, spectators)
			}
		default:
			t.Fatalf("settings status %d: %s", settings.status, settings.payload)
		}
		requireTerminalEventCapacity(t, room.roomID, limit, players, spectators)
	}
}

func TestMultiRacePlayerLimitSettingsVsReadyLinearizes(t *testing.T) {
	for iteration := 0; iteration < 8; iteration++ {
		room := createPlayerLimitRoom(t, map[string]any{"format": "bo1", "mode": "race", "playerLimit": 3})
		resp, payload := fastRequest(http.MethodPost, "/api/rooms/"+room.roomCode+"/join", map[string]any{})
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("join second: %d %s", resp.StatusCode, payload)
		}
		var second openapi.JoinRoomResponse
		if err := json.Unmarshal(payload, &second); err != nil {
			t.Fatal(err)
		}

		start := make(chan struct{})
		settingsResult := make(chan lifecycleResponse, 1)
		readyResult := make(chan lifecycleResponse, 1)
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			resp, payload := fastRequestAuth(http.MethodPatch, "/api/rooms/"+room.roomID+"/settings", room.hostToken, map[string]int{"playerLimit": 2})
			settingsResult <- lifecycleResponse{status: resp.StatusCode, payload: payload}
		}()
		go func() {
			defer wg.Done()
			<-start
			resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+room.roomID+"/ready", string(second.GuestToken), map[string]bool{"ready": true})
			readyResult <- lifecycleResponse{status: resp.StatusCode, payload: payload}
		}()
		close(start)
		wg.Wait()
		settings := <-settingsResult
		readyResponse := <-readyResult
		if readyResponse.status != http.StatusNoContent {
			t.Fatalf("concurrent ready: %d %s", readyResponse.status, readyResponse.payload)
		}
		limit, players, spectators, overLimit, matches, status := playerLimitTerminalCapacity(t, room.roomID)
		if players != 2 || spectators != 0 || overLimit != 0 || matches != 0 || status != string(multi.RoomStatusLobby) {
			t.Fatalf("terminal state limit=%d players=%d spectators=%d over=%d matches=%d status=%s", limit, players, spectators, overLimit, matches, status)
		}
		switch settings.status {
		case http.StatusNoContent:
			if limit != 2 {
				t.Fatalf("settings-first limit=%d, want 2", limit)
			}
		case http.StatusConflict:
			if code := decodeError(t, settings.payload).Code; code != "ROOM_SETTINGS_LOCKED" || limit != 3 {
				t.Fatalf("ready-first settings error=%s limit=%d", code, limit)
			}
		default:
			t.Fatalf("settings status %d: %s", settings.status, settings.payload)
		}
		var memberReady bool
		if err := pool.QueryRow(ctx, `SELECT ready FROM multi_member WHERE id = $1`, second.Viewer.MemberId).Scan(&memberReady); err != nil {
			t.Fatal(err)
		}
		if !memberReady {
			t.Fatal("concurrent ready was lost")
		}
		requireTerminalEventCapacity(t, room.roomID, limit, players, spectators)
	}
}

func TestMultiRacePlayerLimitSettingsJoinFinalReadyLinearizes(t *testing.T) {
	for iteration := 0; iteration < 8; iteration++ {
		room := createPlayerLimitRoom(t, map[string]any{"format": "bo1", "mode": "race", "playerLimit": 3})
		resp, payload := fastRequest(http.MethodPost, "/api/rooms/"+room.roomCode+"/join", map[string]any{})
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("join second: %d %s", resp.StatusCode, payload)
		}
		var second openapi.JoinRoomResponse
		if err := json.Unmarshal(payload, &second); err != nil {
			t.Fatal(err)
		}
		resp, payload = fastRequestAuth(http.MethodPost, "/api/rooms/"+room.roomID+"/ready", room.hostToken, map[string]bool{"ready": true})
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("host ready: %d %s", resp.StatusCode, payload)
		}

		start := make(chan struct{})
		settingsResult := make(chan lifecycleResponse, 1)
		joinResult := make(chan lifecycleResponse, 1)
		readyResult := make(chan lifecycleResponse, 1)
		var wg sync.WaitGroup
		wg.Add(3)
		go func() {
			defer wg.Done()
			<-start
			resp, payload := fastRequestAuth(http.MethodPatch, "/api/rooms/"+room.roomID+"/settings", room.hostToken, map[string]int{"playerLimit": 2})
			settingsResult <- lifecycleResponse{status: resp.StatusCode, payload: payload}
		}()
		go func() {
			defer wg.Done()
			<-start
			resp, payload := fastRequest(http.MethodPost, "/api/rooms/"+room.roomCode+"/join", map[string]any{})
			joinResult <- lifecycleResponse{status: resp.StatusCode, payload: payload}
		}()
		go func() {
			defer wg.Done()
			<-start
			resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+room.roomID+"/ready", string(second.GuestToken), map[string]bool{"ready": true})
			readyResult <- lifecycleResponse{status: resp.StatusCode, payload: payload}
		}()
		close(start)
		wg.Wait()
		settings := <-settingsResult
		joined := <-joinResult
		ready := <-readyResult
		if settings.status != http.StatusConflict || decodeError(t, settings.payload).Code != "ROOM_SETTINGS_LOCKED" {
			t.Fatalf("concurrent settings = %d %s", settings.status, settings.payload)
		}
		if joined.status != http.StatusCreated || ready.status != http.StatusNoContent {
			t.Fatalf("concurrent join/ready = %d/%d: %s / %s", joined.status, ready.status, joined.payload, ready.payload)
		}
		var participant openapi.JoinRoomResponse
		if err := json.Unmarshal(joined.payload, &participant); err != nil {
			t.Fatal(err)
		}
		limit, players, spectators, overLimit, matches, status := playerLimitTerminalCapacity(t, room.roomID)
		if limit != 3 || overLimit != 0 {
			t.Fatalf("locked configuration changed: limit=%d overLimit=%d", limit, overLimit)
		}
		var rosterCount int
		if err := pool.QueryRow(ctx, `SELECT count(*)::int FROM multi_match_player mp JOIN multi_match mm ON mm.id = mp.match_id WHERE mm.room_id = $1`, room.roomID).Scan(&rosterCount); err != nil {
			t.Fatal(err)
		}
		switch participant.JoinRole {
		case openapi.ParticipantRoleSpectator:
			if status != string(multi.RoomStatusPlaying) || players != 2 || spectators != 1 || matches != 1 || rosterCount != 2 {
				t.Fatalf("ready-first status=%s players=%d spectators=%d matches=%d roster=%d", status, players, spectators, matches, rosterCount)
			}
		case openapi.ParticipantRolePlayer:
			if status != string(multi.RoomStatusLobby) || players != 3 || spectators != 0 || matches != 0 || rosterCount != 0 {
				t.Fatalf("join-first status=%s players=%d spectators=%d matches=%d roster=%d", status, players, spectators, matches, rosterCount)
			}
		default:
			t.Fatalf("unexpected concurrent join role %s", participant.JoinRole)
		}
		requireTerminalEventCapacity(t, room.roomID, limit, players, spectators)
	}
}

func TestMultiRacePlayerLimitShrinkCompactsSeatsWithoutChangingIdentity(t *testing.T) {
	room := createPlayerLimitRoom(t, map[string]any{"format": "bo1", "mode": "race", "playerLimit": 5})
	players := make([]openapi.JoinRoomResponse, 0, 4)
	for range 4 {
		resp, payload := fastRequest(http.MethodPost, "/api/rooms/"+room.roomCode+"/join", map[string]any{})
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("join player: %d %s", resp.StatusCode, payload)
		}
		var participant openapi.JoinRoomResponse
		if err := json.Unmarshal(payload, &participant); err != nil {
			t.Fatal(err)
		}
		players = append(players, participant)
	}

	var historicalSequence int64
	var historicalRaw []byte
	if err := pool.QueryRow(ctx, `
		SELECT sequence, payload FROM room_event
		WHERE room_id = $1 AND type = 'room.updated'
		ORDER BY sequence DESC LIMIT 1`, room.roomID).Scan(&historicalSequence, &historicalRaw); err != nil {
		t.Fatal(err)
	}
	var historical multi.RoomUpdatedPayload
	if err := json.Unmarshal(historicalRaw, &historical); err != nil {
		t.Fatal(err)
	}
	if len(historical.Members) != 5 {
		t.Fatalf("historical roster = %+v", historical.Members)
	}

	for _, leaver := range []openapi.JoinRoomResponse{players[0], players[2]} {
		resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+room.roomID+"/leave", string(leaver.GuestToken), nil)
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("leave seat %v: %d %s", leaver.Viewer.Seat, resp.StatusCode, payload)
		}
	}
	remainingSecond := players[1]
	remainingThird := players[3]
	if remainingSecond.Viewer.Seat == nil || *remainingSecond.Viewer.Seat != 3 || remainingThird.Viewer.Seat == nil || *remainingThird.Viewer.Seat != 5 {
		t.Fatalf("pre-compaction seats = %v/%v, want 3/5", remainingSecond.Viewer.Seat, remainingThird.Viewer.Seat)
	}

	conn := wsDial(t, room.roomID, string(remainingSecond.GuestToken), 0, nil)
	drainUntilType(t, conn, "sync.complete", 24)
	resp, payload := fastRequestAuth(http.MethodPatch, "/api/rooms/"+room.roomID+"/settings", room.hostToken, map[string]int{"playerLimit": 3})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("shrink with holes: %d %s", resp.StatusCode, payload)
	}
	updated, _ := roomCapacityEvent(t, conn, 3, 3, 0)
	requirePlayerLimitPayload(t, updated, 3, 3, 0)
	wantSeats := map[string]int{
		room.hostMemberID:               1,
		remainingSecond.Viewer.MemberId: 2,
		remainingThird.Viewer.MemberId:  3,
	}
	members, ok := updated["members"].([]any)
	if !ok || len(members) != 3 {
		t.Fatalf("compacted event members = %#v", updated["members"])
	}
	for _, raw := range members {
		member, ok := raw.(map[string]any)
		if !ok {
			t.Fatalf("member payload = %#v", raw)
		}
		memberID, _ := member["memberId"].(string)
		seat, _ := member["seat"].(float64)
		if int(seat) != wantSeats[memberID] {
			t.Fatalf("event member %s seat=%d, want %d", memberID, int(seat), wantSeats[memberID])
		}
		delete(wantSeats, memberID)
	}
	if len(wantSeats) != 0 {
		t.Fatalf("event missing identities: %v", wantSeats)
	}

	wantDatabaseSeats := map[string]int{
		room.hostMemberID:               1,
		remainingSecond.Viewer.MemberId: 2,
		remainingThird.Viewer.MemberId:  3,
	}
	rows, err := pool.Query(ctx, `SELECT id, seat, token_hash FROM multi_member WHERE room_id = $1 AND role = 'player' ORDER BY seat`, room.roomID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	seen := 0
	for rows.Next() {
		var memberID, tokenHash string
		var seat int
		if err := rows.Scan(&memberID, &seat, &tokenHash); err != nil {
			t.Fatal(err)
		}
		if seat != wantDatabaseSeats[memberID] {
			t.Fatalf("database member %s seat=%d, want %d", memberID, seat, wantDatabaseSeats[memberID])
		}
		switch memberID {
		case room.hostMemberID:
			if tokenHash != multi.HashToken(room.hostToken) {
				t.Fatal("host token changed during compaction")
			}
		case remainingSecond.Viewer.MemberId:
			if tokenHash != multi.HashToken(string(remainingSecond.GuestToken)) {
				t.Fatal("seat 2 token changed during compaction")
			}
		case remainingThird.Viewer.MemberId:
			if tokenHash != multi.HashToken(string(remainingThird.GuestToken)) {
				t.Fatal("seat 3 token changed during compaction")
			}
		default:
			t.Fatalf("unexpected active player %s", memberID)
		}
		seen++
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if seen != 3 {
		t.Fatalf("active players = %d, want 3", seen)
	}

	var historicalAfter []byte
	if err := pool.QueryRow(ctx, `SELECT payload FROM room_event WHERE room_id = $1 AND sequence = $2`, room.roomID, historicalSequence).Scan(&historicalAfter); err != nil {
		t.Fatal(err)
	}
	var preserved multi.RoomUpdatedPayload
	if err := json.Unmarshal(historicalAfter, &preserved); err != nil {
		t.Fatal(err)
	}
	preservedSeats := map[string]int{}
	for _, member := range preserved.Members {
		preservedSeats[member.MemberID] = member.Seat
	}
	if preservedSeats[remainingSecond.Viewer.MemberId] != 3 || preservedSeats[remainingThird.Viewer.MemberId] != 5 {
		t.Fatalf("historical seat snapshot was rewritten: %v", preservedSeats)
	}

	snapshotResp, snapshotPayload := fastRequestAuth(http.MethodGet, "/api/rooms/"+room.roomID+"/snapshot", string(remainingSecond.GuestToken), nil)
	if snapshotResp.StatusCode != http.StatusOK {
		t.Fatalf("compacted player snapshot: %d %s", snapshotResp.StatusCode, snapshotPayload)
	}
	var snapshot openapi.RoomSnapshot
	if err := json.Unmarshal(snapshotPayload, &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Viewer.MemberId != remainingSecond.Viewer.MemberId || snapshot.Viewer.Seat == nil || *snapshot.Viewer.Seat != 2 || snapshot.PlayerLimit != 3 || snapshot.PlayerCount != 3 {
		t.Fatalf("compacted viewer/snapshot = %+v", snapshot)
	}
}
