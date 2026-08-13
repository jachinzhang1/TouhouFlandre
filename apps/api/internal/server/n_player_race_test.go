package server_test

import (
	"encoding/json"
	"net/http"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
)

type nPlayerRaceParticipant struct {
	memberID string
	seat     int
	token    string
}

type nPlayerRaceFixture struct {
	roomID       string
	roomCode     string
	participants []nPlayerRaceParticipant
	snapshot     openapi.RoomSnapshot
}

func createNPlayerRaceFixture(t *testing.T, playerCount int, format string) nPlayerRaceFixture {
	t.Helper()
	resp, payload := fastRequest(http.MethodPost, "/api/rooms", map[string]any{
		"format": format,
		"mode":   "race",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create %d-player race: %d %s", playerCount, resp.StatusCode, payload)
	}
	var created openapi.CreateRoomResponse
	if err := json.Unmarshal(payload, &created); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "UPDATE multi_room SET player_limit = $2 WHERE id = $1", created.RoomId, playerCount); err != nil {
		t.Fatal(err)
	}

	fixture := nPlayerRaceFixture{
		roomID:   created.RoomId,
		roomCode: created.RoomCode,
		participants: []nPlayerRaceParticipant{{
			memberID: created.Viewer.MemberId,
			seat:     1,
			token:    string(created.GuestToken),
		}},
	}
	for seat := 2; seat <= playerCount; seat++ {
		resp, payload = fastRequest(http.MethodPost, "/api/rooms/"+created.RoomCode+"/join", map[string]string{})
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("join seat %d: %d %s", seat, resp.StatusCode, payload)
		}
		var joined openapi.JoinRoomResponse
		if err := json.Unmarshal(payload, &joined); err != nil {
			t.Fatal(err)
		}
		if joined.JoinRole != openapi.ParticipantRolePlayer || joined.Viewer.Seat == nil || *joined.Viewer.Seat != seat {
			t.Fatalf("seat %d participant = %+v", seat, joined)
		}
		fixture.participants = append(fixture.participants, nPlayerRaceParticipant{
			memberID: joined.Viewer.MemberId,
			seat:     seat,
			token:    string(joined.GuestToken),
		})
	}

	for _, participant := range fixture.participants {
		resp, payload = fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/ready", participant.token, map[string]bool{"ready": true})
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("ready seat %d: %d %s", participant.seat, resp.StatusCode, payload)
		}
	}
	time.Sleep(10 * time.Millisecond)
	if err := fastSweeper().SweepOnce(ctx); err != nil {
		t.Fatal(err)
	}
	resp, payload = fastRequestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/snapshot", fixture.participants[0].token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("started race snapshot: %d %s", resp.StatusCode, payload)
	}
	if err := json.Unmarshal(payload, &fixture.snapshot); err != nil {
		t.Fatal(err)
	}
	return fixture
}

func TestMultiTwoPlayerRaceRosterCompatibility(t *testing.T) {
	fixture := createMatchFixtureFormat(t, "bo1")
	started := startMatch(t, fixture)
	hostMemberID := started.Viewer.MemberId
	var guestMemberID string
	for _, member := range started.Members {
		if member.Seat == 2 {
			guestMemberID = member.MemberId
		}
	}
	if guestMemberID == "" {
		t.Fatal("two-player snapshot has no seat 2 member")
	}

	answer := currentAnswer(t, fixture.roomID)
	resp, payload := guess(t, fixture.roomID, fixture.hostToken, 1, answer, "roster-compat-win")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("winning guess: %d %s", resp.StatusCode, payload)
	}

	var matchID, matchStatus, matchWinnerMemberID string
	var scoreSlot1, scoreSlot2 int
	if err := pool.QueryRow(ctx, `
		SELECT id, status, score_slot1, score_slot2, winner_member_id
		FROM multi_match WHERE room_id = $1 ORDER BY match_index DESC LIMIT 1`, fixture.roomID).
		Scan(&matchID, &matchStatus, &scoreSlot1, &scoreSlot2, &matchWinnerMemberID); err != nil {
		t.Fatal(err)
	}
	if matchStatus != string(multi.MatchStatusFinished) || scoreSlot1 != 1 || scoreSlot2 != 0 || matchWinnerMemberID != hostMemberID {
		t.Fatalf("legacy match result status=%s score=%d:%d winner=%s", matchStatus, scoreSlot1, scoreSlot2, matchWinnerMemberID)
	}

	type rosterScore struct {
		memberID string
		seat     int
		wins     int
		status   string
	}
	rows, err := pool.Query(ctx, `
		SELECT member_id, seat, wins, status
		FROM multi_match_player WHERE match_id = $1 ORDER BY seat`, matchID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var roster []rosterScore
	for rows.Next() {
		var player rosterScore
		if err := rows.Scan(&player.memberID, &player.seat, &player.wins, &player.status); err != nil {
			t.Fatal(err)
		}
		roster = append(roster, player)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	wantRoster := []rosterScore{
		{memberID: hostMemberID, seat: 1, wins: 1, status: "active"},
		{memberID: guestMemberID, seat: 2, wins: 0, status: "active"},
	}
	if len(roster) != len(wantRoster) || roster[0] != wantRoster[0] || roster[1] != wantRoster[1] {
		t.Fatalf("member roster = %+v, want %+v", roster, wantRoster)
	}

	var winnerSlot int
	var roundWinnerMemberID string
	var roundPlayerCount int
	if err := pool.QueryRow(ctx, `
		SELECT round.winner_slot, round.winner_member_id,
		       (SELECT count(*) FROM multi_round_player player WHERE player.round_id = round.id)::int
		FROM multi_round AS round
		WHERE round.match_id = $1 AND round.round_index = 1`, matchID).
		Scan(&winnerSlot, &roundWinnerMemberID, &roundPlayerCount); err != nil {
		t.Fatal(err)
	}
	if winnerSlot != 1 || roundWinnerMemberID != hostMemberID || roundPlayerCount != 2 {
		t.Fatalf("round compatibility winnerSlot=%d winnerMemberId=%s players=%d", winnerSlot, roundWinnerMemberID, roundPlayerCount)
	}

	resp, payload = fastRequestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/snapshot", fixture.hostToken, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("finished snapshot: %d %s", resp.StatusCode, payload)
	}
	var snapshot openapi.RoomSnapshot
	if err := json.Unmarshal(payload, &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Status != openapi.RoomStatusFinished || snapshot.Match == nil {
		t.Fatalf("finished business state = %+v", snapshot)
	}
	lastEvent := snapshot.Events[len(snapshot.Events)-1]
	if lastEvent.Type != string(multi.EventMatchEnded) || lastEvent.Payload["winnerMemberId"] != hostMemberID || lastEvent.Payload["viewerResult"] != "win" {
		t.Fatalf("two-player projected result = %+v", lastEvent)
	}
}

func TestMultiRaceStartsThreeFourAndEightPlayerRosters(t *testing.T) {
	for _, playerCount := range []int{3, 4, 8} {
		t.Run(strconv.Itoa(playerCount)+" players", func(t *testing.T) {
			fixture := createNPlayerRaceFixture(t, playerCount, "bo3")
			if fixture.snapshot.Status != openapi.RoomStatusPlaying || len(fixture.snapshot.Members) != playerCount || fixture.snapshot.Match == nil || len(fixture.snapshot.Match.Scores) != playerCount {
				t.Fatalf("%d-player started snapshot = %+v", playerCount, fixture.snapshot)
			}
			var matchPlayers, roundPlayers, distinctSeats int
			if err := pool.QueryRow(ctx, `
				SELECT
					(SELECT count(*) FROM multi_match_player player JOIN multi_match match ON match.id = player.match_id WHERE match.room_id = $1)::int,
					(SELECT count(*) FROM multi_round_player player JOIN multi_round round ON round.id = player.round_id JOIN multi_match match ON match.id = round.match_id WHERE match.room_id = $1)::int,
					(SELECT count(DISTINCT player.seat) FROM multi_match_player player JOIN multi_match match ON match.id = player.match_id WHERE match.room_id = $1)::int`,
				fixture.roomID).Scan(&matchPlayers, &roundPlayers, &distinctSeats); err != nil {
				t.Fatal(err)
			}
			if matchPlayers != playerCount || roundPlayers != playerCount || distinctSeats != playerCount {
				t.Fatalf("%d-player persisted roster match=%d round=%d seats=%d", playerCount, matchPlayers, roundPlayers, distinctSeats)
			}
		})
	}
}

func TestMultiRaceConcurrentCorrectGuessHasOneMemberWinner(t *testing.T) {
	fixture := createNPlayerRaceFixture(t, 4, "bo1")
	answer := currentAnswer(t, fixture.roomID)
	type guessResult struct {
		participant nPlayerRaceParticipant
		status      int
		payload     []byte
	}
	start := make(chan struct{})
	results := make(chan guessResult, len(fixture.participants))
	var wg sync.WaitGroup
	for index, participant := range fixture.participants {
		index, participant := index, participant
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			resp, payload := guess(t, fixture.roomID, participant.token, 1, answer, "n-race-win-"+strconv.Itoa(index))
			results <- guessResult{participant: participant, status: resp.StatusCode, payload: payload}
		}()
	}
	close(start)
	wg.Wait()
	close(results)

	succeeded := 0
	winnerMemberID := ""
	for result := range results {
		switch result.status {
		case http.StatusOK:
			succeeded++
			winnerMemberID = result.participant.memberID
		case http.StatusConflict:
			code := decodeError(t, result.payload).Code
			if code != "ROUND_ENDED" && code != "ROUND_NOT_ACTIVE" {
				t.Fatalf("losing correct guess error = %s", code)
			}
		default:
			t.Fatalf("concurrent correct guess = %d %s", result.status, result.payload)
		}
	}
	if succeeded != 1 {
		t.Fatalf("concurrent correct guesses succeeded = %d, want 1", succeeded)
	}

	var roundWinner, matchWinner, roomStatus, matchStatus string
	var scoreSum, scoringPlayers, guessCount, roundEndedEvents, matchEndedEvents int
	if err := pool.QueryRow(ctx, `
		SELECT
			room.status,
			match.status,
			round.winner_member_id,
			match.winner_member_id,
			(SELECT sum(wins)::int FROM multi_match_player WHERE match_id = match.id),
			(SELECT count(*)::int FROM multi_match_player WHERE match_id = match.id AND wins = 1),
			(SELECT count(*)::int FROM multi_guess WHERE round_id = round.id),
			(SELECT count(*)::int FROM room_event WHERE room_id = room.id AND type = 'round.ended'),
			(SELECT count(*)::int FROM room_event WHERE room_id = room.id AND type = 'match.ended')
		FROM multi_room AS room
		JOIN multi_match AS match ON match.room_id = room.id
		JOIN multi_round AS round ON round.match_id = match.id
		WHERE room.id = $1`, fixture.roomID).Scan(
		&roomStatus, &matchStatus, &roundWinner, &matchWinner,
		&scoreSum, &scoringPlayers, &guessCount, &roundEndedEvents, &matchEndedEvents,
	); err != nil {
		t.Fatal(err)
	}
	if roomStatus != string(multi.RoomStatusFinished) || matchStatus != string(multi.MatchStatusFinished) || roundWinner != winnerMemberID || matchWinner != winnerMemberID || scoreSum != 1 || scoringPlayers != 1 || guessCount != 1 || roundEndedEvents != 1 || matchEndedEvents != 1 {
		t.Fatalf("concurrent terminal room=%s match=%s roundWinner=%s matchWinner=%s scoreSum=%d scorers=%d guesses=%d events=%d/%d want winner=%s",
			roomStatus, matchStatus, roundWinner, matchWinner, scoreSum, scoringPlayers, guessCount, roundEndedEvents, matchEndedEvents, winnerMemberID)
	}

	resp, payload := fastRequestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/snapshot", fixture.participants[0].token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("concurrent winner snapshot: %d %s", resp.StatusCode, payload)
	}
	var snapshot openapi.RoomSnapshot
	if err := json.Unmarshal(payload, &snapshot); err != nil {
		t.Fatal(err)
	}
	lastEvent := snapshot.Events[len(snapshot.Events)-1]
	serialized, err := json.Marshal(lastEvent.Payload)
	if err != nil {
		t.Fatal(err)
	}
	var ended multi.MatchEndedPayload
	if err := json.Unmarshal(serialized, &ended); err != nil {
		t.Fatal(err)
	}
	if lastEvent.Type != string(multi.EventMatchEnded) || ended.WinnerMemberID == nil || *ended.WinnerMemberID != winnerMemberID || len(ended.Scores) != 4 || len(ended.Results) != 4 {
		t.Fatalf("concurrent projected match result = %+v", ended)
	}
	winners := 0
	for _, result := range ended.Results {
		if result.Result == multi.MatchResultWin {
			winners++
		}
	}
	if winners != 1 {
		t.Fatalf("projected result winners = %d, want 1", winners)
	}
}
