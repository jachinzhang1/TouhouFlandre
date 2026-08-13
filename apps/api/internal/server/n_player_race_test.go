package server_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
)

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
