package server_test

import (
	"encoding/json"
	"net/http"
	"sync"
	"testing"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
)

type lifecycleRoom struct {
	roomID      string
	roomCode    string
	hostToken   string
	joinerToken string
	spectators  []openapi.JoinRoomResponse
}

func createLifecycleRoom(t *testing.T, spectatorCount int) lifecycleRoom {
	t.Helper()
	resp, payload := fastRequest(http.MethodPost, "/api/rooms", map[string]any{
		"format": "bo1",
		"mode":   "race",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create lifecycle room: %d %s", resp.StatusCode, payload)
	}
	var created openapi.CreateRoomResponse
	if err := json.Unmarshal(payload, &created); err != nil {
		t.Fatal(err)
	}

	resp, payload = fastRequest(http.MethodPost, "/api/rooms/"+created.RoomCode+"/join", map[string]string{})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("join lifecycle player: %d %s", resp.StatusCode, payload)
	}
	var joined openapi.JoinRoomResponse
	if err := json.Unmarshal(payload, &joined); err != nil {
		t.Fatal(err)
	}

	fixture := lifecycleRoom{
		roomID:      created.RoomId,
		roomCode:    created.RoomCode,
		hostToken:   string(created.GuestToken),
		joinerToken: string(joined.GuestToken),
	}
	for range spectatorCount {
		resp, payload = fastRequest(http.MethodPost, "/api/rooms/"+created.RoomCode+"/join", map[string]string{})
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("join lifecycle spectator: %d %s", resp.StatusCode, payload)
		}
		var spectator openapi.JoinRoomResponse
		if err := json.Unmarshal(payload, &spectator); err != nil {
			t.Fatal(err)
		}
		if spectator.JoinRole != openapi.ParticipantRoleSpectator {
			t.Fatalf("lifecycle spectator role = %s", spectator.JoinRole)
		}
		fixture.spectators = append(fixture.spectators, spectator)
	}
	return fixture
}

type lifecycleResponse struct {
	status  int
	payload []byte
}

func TestMultiJoinVsFinalReadyLinearizes(t *testing.T) {
	for iteration := 0; iteration < 8; iteration++ {
		fixture := createLifecycleRoom(t, 0)
		if _, err := pool.Exec(ctx, "UPDATE multi_room SET player_limit = 3 WHERE id = $1", fixture.roomID); err != nil {
			t.Fatal(err)
		}
		if resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/ready", fixture.hostToken, map[string]bool{"ready": true}); resp.StatusCode != http.StatusNoContent {
			t.Fatalf("host ready: %d %s", resp.StatusCode, payload)
		}

		start := make(chan struct{})
		joinResult := make(chan lifecycleResponse, 1)
		readyResult := make(chan lifecycleResponse, 1)
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			resp, payload := fastRequest(http.MethodPost, "/api/rooms/"+fixture.roomCode+"/join", map[string]string{})
			joinResult <- lifecycleResponse{status: resp.StatusCode, payload: payload}
		}()
		go func() {
			defer wg.Done()
			<-start
			resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/ready", fixture.joinerToken, map[string]bool{"ready": true})
			readyResult <- lifecycleResponse{status: resp.StatusCode, payload: payload}
		}()
		close(start)
		wg.Wait()

		join := <-joinResult
		ready := <-readyResult
		if join.status != http.StatusCreated || ready.status != http.StatusNoContent {
			t.Fatalf("concurrent join/ready = join %d %s, ready %d %s", join.status, join.payload, ready.status, ready.payload)
		}
		var participant openapi.JoinRoomResponse
		if err := json.Unmarshal(join.payload, &participant); err != nil {
			t.Fatal(err)
		}

		var status string
		var playerCount, matchCount, newPlayerReady int
		if err := pool.QueryRow(ctx, `
			SELECT r.status,
			       count(DISTINCT p.id)::int,
			       count(DISTINCT m.id)::int,
			       count(DISTINCT p.id) FILTER (WHERE p.id = $2 AND p.ready)::int
			FROM multi_room r
			LEFT JOIN multi_member p ON p.room_id = r.id AND p.role = 'player'
			LEFT JOIN multi_match m ON m.room_id = r.id
			WHERE r.id = $1
			GROUP BY r.status`, fixture.roomID, participant.Viewer.MemberId).Scan(&status, &playerCount, &matchCount, &newPlayerReady); err != nil {
			t.Fatal(err)
		}
		switch participant.JoinRole {
		case openapi.ParticipantRoleSpectator:
			if status != string(multi.RoomStatusPlaying) || playerCount != 2 || matchCount != 1 {
				t.Fatalf("ready-first result status=%s players=%d matches=%d", status, playerCount, matchCount)
			}
		case openapi.ParticipantRolePlayer:
			if status != string(multi.RoomStatusLobby) || playerCount != 3 || matchCount != 0 || newPlayerReady != 0 {
				t.Fatalf("join-first result status=%s players=%d matches=%d newReady=%d", status, playerCount, matchCount, newPlayerReady)
			}
		default:
			t.Fatalf("unexpected concurrent join role %s", participant.JoinRole)
		}
	}
}

func TestMultiClaimSeatVsFinalReadyLinearizes(t *testing.T) {
	for iteration := 0; iteration < 8; iteration++ {
		fixture := createLifecycleRoom(t, 1)
		if _, err := pool.Exec(ctx, "UPDATE multi_room SET player_limit = 3 WHERE id = $1", fixture.roomID); err != nil {
			t.Fatal(err)
		}
		if resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/ready", fixture.hostToken, map[string]bool{"ready": true}); resp.StatusCode != http.StatusNoContent {
			t.Fatalf("host ready: %d %s", resp.StatusCode, payload)
		}

		claimToken := string(fixture.spectators[0].GuestToken)
		claimMemberID := fixture.spectators[0].Viewer.MemberId
		start := make(chan struct{})
		claimResult := make(chan lifecycleResponse, 1)
		readyResult := make(chan lifecycleResponse, 1)
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/claim-seat", claimToken, nil)
			claimResult <- lifecycleResponse{status: resp.StatusCode, payload: payload}
		}()
		go func() {
			defer wg.Done()
			<-start
			resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/ready", fixture.joinerToken, map[string]bool{"ready": true})
			readyResult <- lifecycleResponse{status: resp.StatusCode, payload: payload}
		}()
		close(start)
		wg.Wait()

		claim := <-claimResult
		ready := <-readyResult
		if ready.status != http.StatusNoContent {
			t.Fatalf("final ready: %d %s", ready.status, ready.payload)
		}
		var status, claimantRole string
		var playerCount, matchCount int
		var claimantReady bool
		if err := pool.QueryRow(ctx, `
			SELECT r.status, c.role, c.ready,
			       (SELECT count(*) FROM multi_member p WHERE p.room_id = r.id AND p.role = 'player')::int,
			       (SELECT count(*) FROM multi_match m WHERE m.room_id = r.id)::int
			FROM multi_room r JOIN multi_member c ON c.room_id = r.id AND c.id = $2
			WHERE r.id = $1`, fixture.roomID, claimMemberID).Scan(&status, &claimantRole, &claimantReady, &playerCount, &matchCount); err != nil {
			t.Fatal(err)
		}
		switch claim.status {
		case http.StatusNoContent:
			if status != string(multi.RoomStatusLobby) || claimantRole != string(multi.ParticipantRolePlayer) || claimantReady || playerCount != 3 || matchCount != 0 {
				t.Fatalf("claim-first result status=%s role=%s ready=%v players=%d matches=%d", status, claimantRole, claimantReady, playerCount, matchCount)
			}
		case http.StatusConflict:
			if apiErr := decodeError(t, claim.payload); apiErr.Code != "MATCH_ALREADY_STARTED" {
				t.Fatalf("ready-first claim error = %s", apiErr.Code)
			}
			if status != string(multi.RoomStatusPlaying) || claimantRole != string(multi.ParticipantRoleSpectator) || playerCount != 2 || matchCount != 1 {
				t.Fatalf("ready-first result status=%s role=%s players=%d matches=%d", status, claimantRole, playerCount, matchCount)
			}
		default:
			t.Fatalf("claim status %d: %s", claim.status, claim.payload)
		}
	}
}

func TestMultiConcurrentClaimLastSeatAtMostOne(t *testing.T) {
	fixture := createLifecycleRoom(t, 2)
	if _, err := pool.Exec(ctx, "UPDATE multi_room SET player_limit = 3 WHERE id = $1", fixture.roomID); err != nil {
		t.Fatal(err)
	}

	start := make(chan struct{})
	results := make(chan lifecycleResponse, len(fixture.spectators))
	var wg sync.WaitGroup
	for _, spectator := range fixture.spectators {
		token := string(spectator.GuestToken)
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/claim-seat", token, nil)
			results <- lifecycleResponse{status: resp.StatusCode, payload: payload}
		}()
	}
	close(start)
	wg.Wait()
	close(results)

	succeeded, full := 0, 0
	for result := range results {
		switch result.status {
		case http.StatusNoContent:
			succeeded++
		case http.StatusConflict:
			if apiErr := decodeError(t, result.payload); apiErr.Code != "ROOM_FULL" {
				t.Fatalf("losing claim error = %s", apiErr.Code)
			}
			full++
		default:
			t.Fatalf("claim status %d: %s", result.status, result.payload)
		}
	}
	if succeeded != 1 || full != 1 {
		t.Fatalf("concurrent claims succeeded=%d full=%d", succeeded, full)
	}

	var players, spectators, seatThree, readyPlayers int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE role = 'player')::int,
		       count(*) FILTER (WHERE role = 'spectator')::int,
		       count(*) FILTER (WHERE role = 'player' AND seat = 3)::int,
		       count(*) FILTER (WHERE role = 'player' AND ready)::int
		FROM multi_member WHERE room_id = $1`, fixture.roomID).Scan(&players, &spectators, &seatThree, &readyPlayers); err != nil {
		t.Fatal(err)
	}
	if players != 3 || spectators != 1 || seatThree != 1 || readyPlayers != 0 {
		t.Fatalf("claim terminal state players=%d spectators=%d seat3=%d ready=%d", players, spectators, seatThree, readyPlayers)
	}
}

func TestMultiUnreadyRejectedAfterMatchCreated(t *testing.T) {
	fixture := createMatchFixtureFormat(t, "bo1")
	for _, token := range []string{fixture.hostToken, fixture.joinerToken} {
		resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/ready", token, map[string]bool{"ready": true})
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("start ready: %d %s", resp.StatusCode, payload)
		}
	}
	resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/ready", fixture.hostToken, map[string]bool{"ready": false})
	if resp.StatusCode != http.StatusConflict || decodeError(t, payload).Code != "MATCH_ALREADY_STARTED" {
		t.Fatalf("post-match unready = %d %s, want MATCH_ALREADY_STARTED", resp.StatusCode, payload)
	}
}

func TestMultiSpectatorWriteCommandsAreReadOnly(t *testing.T) {
	fixture := createLifecycleRoom(t, 1)
	token := string(fixture.spectators[0].GuestToken)
	var initialSequence int64
	if err := pool.QueryRow(ctx, "SELECT event_seq FROM multi_room WHERE id = $1", fixture.roomID).Scan(&initialSequence); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name   string
		method string
		path   string
		body   any
	}{
		{name: "ready", method: http.MethodPost, path: "/api/rooms/" + fixture.roomID + "/ready", body: map[string]bool{"ready": true}},
		{name: "unready", method: http.MethodPost, path: "/api/rooms/" + fixture.roomID + "/ready", body: map[string]bool{"ready": false}},
		{name: "forfeit", method: http.MethodPost, path: "/api/rooms/" + fixture.roomID + "/rounds/1/forfeit"},
		{name: "guess", method: http.MethodPost, path: "/api/rooms/" + fixture.roomID + "/rounds/1/guess", body: map[string]string{"guessId": "spectator", "idempotencyKey": "spectator"}},
		{name: "pass", method: http.MethodPost, path: "/api/rooms/" + fixture.roomID + "/rounds/1/pass"},
		{name: "rematch", method: http.MethodPost, path: "/api/rooms/" + fixture.roomID + "/rematch"},
		{name: "close", method: http.MethodDelete, path: "/api/rooms/" + fixture.roomID},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			resp, payload := fastRequestAuth(test.method, test.path, token, test.body)
			if resp.StatusCode != http.StatusForbidden || decodeError(t, payload).Code != "SPECTATOR_READ_ONLY" {
				t.Fatalf("spectator %s = %d %s, want SPECTATOR_READ_ONLY", test.name, resp.StatusCode, payload)
			}
		})
	}

	var finalSequence int64
	if err := pool.QueryRow(ctx, "SELECT event_seq FROM multi_room WHERE id = $1", fixture.roomID).Scan(&finalSequence); err != nil {
		t.Fatal(err)
	}
	if finalSequence != initialSequence {
		t.Fatalf("spectator write attempts mutated event sequence: before=%d after=%d", initialSequence, finalSequence)
	}
}
