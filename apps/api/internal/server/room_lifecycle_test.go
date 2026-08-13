package server_test

import (
	"encoding/json"
	"net/http"
	"reflect"
	"strings"
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

type lifecycleParticipantResponse struct {
	participant openapi.JoinRoomResponse
	response    lifecycleResponse
}

type lifecycleMemberIdentity struct {
	MemberID string
	Seat     int
}

func publicMemberIdentities(members []openapi.PublicMemberView) []lifecycleMemberIdentity {
	identities := make([]lifecycleMemberIdentity, 0, len(members))
	for _, member := range members {
		identities = append(identities, lifecycleMemberIdentity{MemberID: member.MemberId, Seat: member.Seat})
	}
	return identities
}

func snapshotMemberIdentities(members []openapi.MemberView) []lifecycleMemberIdentity {
	identities := make([]lifecycleMemberIdentity, 0, len(members))
	for _, member := range members {
		identities = append(identities, lifecycleMemberIdentity{MemberID: member.MemberId, Seat: member.Seat})
	}
	return identities
}

func latestRoomUpdatedPayload(t *testing.T, snapshot openapi.RoomSnapshot) multi.RoomUpdatedPayload {
	t.Helper()
	for index := len(snapshot.Events) - 1; index >= 0; index-- {
		if snapshot.Events[index].Type != string(multi.EventRoomUpdated) {
			continue
		}
		payload, err := json.Marshal(snapshot.Events[index].Payload)
		if err != nil {
			t.Fatal(err)
		}
		var updated multi.RoomUpdatedPayload
		if err := json.Unmarshal(payload, &updated); err != nil {
			t.Fatal(err)
		}
		return updated
	}
	t.Fatal("snapshot has no room.updated event")
	return multi.RoomUpdatedPayload{}
}

func TestMultiRoomObserversShareCapacityAndPublicIdentity(t *testing.T) {
	fixture := createLifecycleRoom(t, 1)
	if _, err := pool.Exec(ctx, "UPDATE multi_room SET player_limit = 3 WHERE id = $1", fixture.roomID); err != nil {
		t.Fatal(err)
	}
	// Emit a fresh room.updated after the capacity change without starting the match.
	if resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/ready", fixture.hostToken, map[string]bool{"ready": true}); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("host ready: %d %s", resp.StatusCode, payload)
	}

	infoResp, infoPayload := fastRequest(http.MethodGet, "/api/rooms/"+fixture.roomCode, nil)
	if infoResp.StatusCode != http.StatusOK {
		t.Fatalf("room info: %d %s", infoResp.StatusCode, infoPayload)
	}
	var info openapi.RoomInfo
	if err := json.Unmarshal(infoPayload, &info); err != nil {
		t.Fatal(err)
	}

	hostResp, hostPayload := fastRequestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/snapshot", fixture.hostToken, nil)
	if hostResp.StatusCode != http.StatusOK {
		t.Fatalf("host snapshot: %d %s", hostResp.StatusCode, hostPayload)
	}
	var hostSnapshot openapi.RoomSnapshot
	if err := json.Unmarshal(hostPayload, &hostSnapshot); err != nil {
		t.Fatal(err)
	}

	spectatorToken := string(fixture.spectators[0].GuestToken)
	spectatorResp, spectatorPayload := fastRequestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/snapshot", spectatorToken, nil)
	if spectatorResp.StatusCode != http.StatusOK {
		t.Fatalf("spectator snapshot: %d %s", spectatorResp.StatusCode, spectatorPayload)
	}
	var spectatorSnapshot openapi.RoomSnapshot
	if err := json.Unmarshal(spectatorPayload, &spectatorSnapshot); err != nil {
		t.Fatal(err)
	}

	hostUpdated := latestRoomUpdatedPayload(t, hostSnapshot)
	spectatorUpdated := latestRoomUpdatedPayload(t, spectatorSnapshot)
	for observer, capacity := range map[string][5]int{
		"room info":          {info.PlayerLimit, int(info.MinPlayers), info.PlayerCount, info.AvailableSeats, info.SpectatorCount},
		"host snapshot":      {hostSnapshot.PlayerLimit, int(hostSnapshot.MinPlayers), hostSnapshot.PlayerCount, hostSnapshot.AvailableSeats, hostSnapshot.SpectatorCount},
		"spectator snapshot": {spectatorSnapshot.PlayerLimit, int(spectatorSnapshot.MinPlayers), spectatorSnapshot.PlayerCount, spectatorSnapshot.AvailableSeats, spectatorSnapshot.SpectatorCount},
		"host room.updated":  {hostUpdated.PlayerLimit, hostUpdated.MinPlayers, hostUpdated.PlayerCount, hostUpdated.AvailableSeats, hostUpdated.SpectatorCount},
		"guest room.updated": {spectatorUpdated.PlayerLimit, spectatorUpdated.MinPlayers, spectatorUpdated.PlayerCount, spectatorUpdated.AvailableSeats, spectatorUpdated.SpectatorCount},
	} {
		if capacity != [5]int{3, multi.MinPlayers, 2, 1, 1} {
			t.Fatalf("%s capacity = %v, want [3 2 2 1 1]", observer, capacity)
		}
	}

	wantMembers := publicMemberIdentities(info.Members)
	for observer, gotMembers := range map[string][]lifecycleMemberIdentity{
		"host snapshot":      snapshotMemberIdentities(hostSnapshot.Members),
		"spectator snapshot": snapshotMemberIdentities(spectatorSnapshot.Members),
		"host room.updated":  snapshotMemberIdentitiesFromDomain(hostUpdated.Members),
		"guest room.updated": snapshotMemberIdentitiesFromDomain(spectatorUpdated.Members),
	} {
		if !reflect.DeepEqual(gotMembers, wantMembers) {
			t.Fatalf("%s members = %v, want %v", observer, gotMembers, wantMembers)
		}
	}

	serialized := string(infoPayload) + string(hostPayload) + string(spectatorPayload)
	if strings.Contains(string(infoPayload), `"displayName"`) {
		t.Fatalf("public room info leaked display names: %s", infoPayload)
	}
	for _, forbiddenKey := range []string{`"guestToken"`, `"token"`, `"tokenHash"`} {
		if strings.Contains(serialized, forbiddenKey) {
			t.Fatalf("observer payload leaked forbidden key %s", forbiddenKey)
		}
	}
	var tokenHashes []string
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(array_agg(token_hash ORDER BY id), ARRAY[]::text[])
		FROM multi_member WHERE room_id = $1`, fixture.roomID).Scan(&tokenHashes); err != nil {
		t.Fatal(err)
	}
	for _, secret := range append(tokenHashes, fixture.hostToken, fixture.joinerToken, spectatorToken) {
		if strings.Contains(serialized, secret) {
			t.Fatal("observer payload leaked a member credential")
		}
	}
}

func snapshotMemberIdentitiesFromDomain(members []multi.MemberView) []lifecycleMemberIdentity {
	identities := make([]lifecycleMemberIdentity, 0, len(members))
	for _, member := range members {
		identities = append(identities, lifecycleMemberIdentity{MemberID: member.MemberID, Seat: member.Seat})
	}
	return identities
}

func TestMultiCompleteConcurrentRoomLifecycleAndRetention(t *testing.T) {
	t.Run("concurrent admission claim reconnect host close and cleanup", func(t *testing.T) {
		fixture := createLifecycleRoom(t, 0)
		if _, err := pool.Exec(ctx, "UPDATE multi_room SET player_limit = 3 WHERE id = $1", fixture.roomID); err != nil {
			t.Fatal(err)
		}

		start := make(chan struct{})
		joinResults := make(chan lifecycleParticipantResponse, 4)
		var joinWG sync.WaitGroup
		for range 4 {
			joinWG.Add(1)
			go func() {
				defer joinWG.Done()
				<-start
				resp, payload := fastRequest(http.MethodPost, "/api/rooms/"+fixture.roomCode+"/join", map[string]string{})
				result := lifecycleParticipantResponse{response: lifecycleResponse{status: resp.StatusCode, payload: payload}}
				if resp.StatusCode == http.StatusCreated {
					if err := json.Unmarshal(payload, &result.participant); err != nil {
						t.Errorf("decode concurrent join: %v", err)
						return
					}
				}
				joinResults <- result
			}()
		}
		close(start)
		joinWG.Wait()
		close(joinResults)

		concurrentPlayers := make([]openapi.JoinRoomResponse, 0, 1)
		concurrentSpectators := make([]openapi.JoinRoomResponse, 0, 3)
		for result := range joinResults {
			if result.response.status != http.StatusCreated {
				t.Fatalf("concurrent join = %d %s", result.response.status, result.response.payload)
			}
			switch result.participant.JoinRole {
			case openapi.ParticipantRolePlayer:
				concurrentPlayers = append(concurrentPlayers, result.participant)
			case openapi.ParticipantRoleSpectator:
				concurrentSpectators = append(concurrentSpectators, result.participant)
			default:
				t.Fatalf("concurrent join role = %s", result.participant.JoinRole)
			}
		}
		if len(concurrentPlayers) != 1 || len(concurrentSpectators) != 3 || concurrentPlayers[0].Viewer.Seat == nil || *concurrentPlayers[0].Viewer.Seat != 3 {
			t.Fatalf("concurrent admission players=%+v spectators=%d", concurrentPlayers, len(concurrentSpectators))
		}

		// Free seat 2 explicitly; spectators remain spectators until an explicit claim.
		if resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/leave", fixture.joinerToken, nil); resp.StatusCode != http.StatusNoContent {
			t.Fatalf("player leave: %d %s", resp.StatusCode, payload)
		}

		claimStart := make(chan struct{})
		claimResults := make(chan lifecycleParticipantResponse, len(concurrentSpectators))
		var claimWG sync.WaitGroup
		for _, spectator := range concurrentSpectators {
			spectator := spectator
			claimWG.Add(1)
			go func() {
				defer claimWG.Done()
				<-claimStart
				resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/claim-seat", string(spectator.GuestToken), nil)
				claimResults <- lifecycleParticipantResponse{
					participant: spectator,
					response:    lifecycleResponse{status: resp.StatusCode, payload: payload},
				}
			}()
		}
		close(claimStart)
		claimWG.Wait()
		close(claimResults)

		var claimant openapi.JoinRoomResponse
		claimSucceeded, claimFull := 0, 0
		for result := range claimResults {
			switch result.response.status {
			case http.StatusNoContent:
				claimSucceeded++
				claimant = result.participant
			case http.StatusConflict:
				if apiErr := decodeError(t, result.response.payload); apiErr.Code != "ROOM_FULL" {
					t.Fatalf("losing lifecycle claim = %s", apiErr.Code)
				}
				claimFull++
			default:
				t.Fatalf("lifecycle claim = %d %s", result.response.status, result.response.payload)
			}
		}
		if claimSucceeded != 1 || claimFull != 2 {
			t.Fatalf("lifecycle claims succeeded=%d full=%d", claimSucceeded, claimFull)
		}

		// The same token reauthenticates as the same member with the newly assigned seat.
		resp, payload := fastRequestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/snapshot", string(claimant.GuestToken), nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("claimant reconnect snapshot: %d %s", resp.StatusCode, payload)
		}
		var claimantSnapshot openapi.RoomSnapshot
		if err := json.Unmarshal(payload, &claimantSnapshot); err != nil {
			t.Fatal(err)
		}
		if claimantSnapshot.Viewer.MemberId != claimant.Viewer.MemberId || claimantSnapshot.Viewer.Role != openapi.ParticipantRolePlayer || claimantSnapshot.Viewer.Seat == nil || *claimantSnapshot.Viewer.Seat != 2 {
			t.Fatalf("claimant reconnect identity = %+v, original member = %s", claimantSnapshot.Viewer, claimant.Viewer.MemberId)
		}

		if resp, payload = fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/leave", fixture.hostToken, nil); resp.StatusCode != http.StatusNoContent {
			t.Fatalf("host leave: %d %s", resp.StatusCode, payload)
		}
		resp, payload = fastRequestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/snapshot", string(claimant.GuestToken), nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("closed room snapshot: %d %s", resp.StatusCode, payload)
		}
		var closedSnapshot openapi.RoomSnapshot
		if err := json.Unmarshal(payload, &closedSnapshot); err != nil {
			t.Fatal(err)
		}
		lastEvent := closedSnapshot.Events[len(closedSnapshot.Events)-1]
		if closedSnapshot.Status != openapi.RoomStatusClosed || lastEvent.Type != string(multi.EventRoomClosed) || lastEvent.Payload["reason"] != string(multi.RoomCloseReasonHostLeft) {
			t.Fatalf("host close terminal snapshot = status %s event %+v", closedSnapshot.Status, lastEvent)
		}

		if _, err := pool.Exec(ctx, "UPDATE multi_room SET expires_at = now() - interval '1 second' WHERE id = $1", fixture.roomID); err != nil {
			t.Fatal(err)
		}
		if err := fastSweeper().SweepOnce(ctx); err != nil {
			t.Fatal(err)
		}
		var roomCount, memberCount int
		if err := pool.QueryRow(ctx, `
			SELECT count(DISTINCT r.id)::int, count(DISTINCT m.id)::int
			FROM (SELECT $1::text AS id) target
			LEFT JOIN multi_room r ON r.id = target.id
			LEFT JOIN multi_member m ON m.room_id = target.id`, fixture.roomID).Scan(&roomCount, &memberCount); err != nil {
			t.Fatal(err)
		}
		if roomCount != 0 || memberCount != 0 {
			t.Fatalf("closed room cleanup rooms=%d members=%d", roomCount, memberCount)
		}
		if resp, _ := fastRequestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/snapshot", string(claimant.GuestToken), nil); resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("claimant token after cleanup = %d, want 401", resp.StatusCode)
		}
	})

	t.Run("finished spectators survive retention then cascade cleanup", func(t *testing.T) {
		fixture := createMatchFixtureFormat(t, "bo1")
		resp, payload := fastRequest(http.MethodPost, "/api/rooms/"+fixture.roomCode+"/join", map[string]string{})
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("finished lifecycle spectator join: %d %s", resp.StatusCode, payload)
		}
		var spectator openapi.JoinRoomResponse
		if err := json.Unmarshal(payload, &spectator); err != nil {
			t.Fatal(err)
		}
		if spectator.JoinRole != openapi.ParticipantRoleSpectator {
			t.Fatalf("finished lifecycle observer role = %s", spectator.JoinRole)
		}

		startMatch(t, fixture)
		answer := currentAnswer(t, fixture.roomID)
		if resp, payload = guess(t, fixture.roomID, fixture.hostToken, 1, answer, "complete-lifecycle-finish"); resp.StatusCode != http.StatusOK {
			t.Fatalf("finish lifecycle match: %d %s", resp.StatusCode, payload)
		}

		spectatorToken := string(spectator.GuestToken)
		resp, payload = fastRequestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/snapshot", spectatorToken, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("finished spectator snapshot: %d %s", resp.StatusCode, payload)
		}
		var finishedSnapshot openapi.RoomSnapshot
		if err := json.Unmarshal(payload, &finishedSnapshot); err != nil {
			t.Fatal(err)
		}
		if finishedSnapshot.Status != openapi.RoomStatusFinished || finishedSnapshot.Viewer.Role != openapi.ParticipantRoleSpectator {
			t.Fatalf("finished retention snapshot = %+v", finishedSnapshot)
		}

		if _, err := pool.Exec(ctx, "UPDATE multi_room SET expires_at = now() - interval '1 second' WHERE id = $1", fixture.roomID); err != nil {
			t.Fatal(err)
		}
		if err := fastSweeper().SweepOnce(ctx); err != nil {
			t.Fatal(err)
		}
		resp, payload = fastRequestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/snapshot", spectatorToken, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("retention-closed spectator snapshot: %d %s", resp.StatusCode, payload)
		}
		var retentionSnapshot openapi.RoomSnapshot
		if err := json.Unmarshal(payload, &retentionSnapshot); err != nil {
			t.Fatal(err)
		}
		lastEvent := retentionSnapshot.Events[len(retentionSnapshot.Events)-1]
		if retentionSnapshot.Status != openapi.RoomStatusClosed || lastEvent.Type != string(multi.EventRoomClosed) || lastEvent.Payload["reason"] != string(multi.RoomCloseReasonRetention) {
			t.Fatalf("retention close snapshot = status %s event %+v", retentionSnapshot.Status, lastEvent)
		}

		if _, err := pool.Exec(ctx, "UPDATE multi_room SET expires_at = now() - interval '1 second' WHERE id = $1", fixture.roomID); err != nil {
			t.Fatal(err)
		}
		if err := fastSweeper().SweepOnce(ctx); err != nil {
			t.Fatal(err)
		}
		var roomCount, matchCount, eventCount, memberCount int
		if err := pool.QueryRow(ctx, `
			SELECT
				(SELECT count(*) FROM multi_room WHERE id = $1)::int,
				(SELECT count(*) FROM multi_match WHERE room_id = $1)::int,
				(SELECT count(*) FROM room_event WHERE room_id = $1)::int,
				(SELECT count(*) FROM multi_member WHERE room_id = $1)::int`, fixture.roomID).Scan(&roomCount, &matchCount, &eventCount, &memberCount); err != nil {
			t.Fatal(err)
		}
		if roomCount != 0 || matchCount != 0 || eventCount != 0 || memberCount != 0 {
			t.Fatalf("retention cleanup rooms=%d matches=%d events=%d members=%d", roomCount, matchCount, eventCount, memberCount)
		}
		for _, token := range []string{fixture.hostToken, fixture.joinerToken, spectatorToken} {
			if resp, _ := fastRequestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/snapshot", token, nil); resp.StatusCode != http.StatusUnauthorized {
				t.Fatalf("retained credential after cleanup = %d, want 401", resp.StatusCode)
			}
		}
	})
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
