package server_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"slices"
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

func TestMultiRacePlayerProjectionPrivacyAndSpectatorBoards(t *testing.T) {
	fixture := createNPlayerRaceFixture(t, 4, "bo3")
	answer := currentAnswer(t, fixture.roomID)
	wrong := guessableIDs(t, answer, 1)[0]

	for _, participant := range fixture.participants[1:3] {
		resp, payload := guess(t, fixture.roomID, participant.token, 1, wrong, "privacy-"+strconv.Itoa(participant.seat))
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("seat %d privacy guess: %d %s", participant.seat, resp.StatusCode, payload)
		}
	}

	resp, payload := fastRequest(http.MethodPost, "/api/rooms/"+fixture.roomCode+"/join", map[string]string{})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("join privacy spectator: %d %s", resp.StatusCode, payload)
	}
	var spectator openapi.JoinRoomResponse
	if err := json.Unmarshal(payload, &spectator); err != nil {
		t.Fatal(err)
	}
	if spectator.JoinRole != openapi.ParticipantRoleSpectator {
		t.Fatalf("privacy observer role = %s", spectator.JoinRole)
	}

	type persistedGuess struct {
		memberID string
		statuses []string
	}
	var roundID string
	rows, err := pool.Query(ctx, `
		SELECT round.id, guess.member_id, guess.statuses
		FROM multi_round AS round
		JOIN multi_match AS match ON match.id = round.match_id
		JOIN multi_guess AS guess ON guess.round_id = round.id
		WHERE match.room_id = $1 AND round.status = 'playing'
		ORDER BY guess.member_id`, fixture.roomID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	persisted := map[string][]string{}
	for rows.Next() {
		var row persistedGuess
		var raw []byte
		if err := rows.Scan(&roundID, &row.memberID, &raw); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(raw, &row.statuses); err != nil {
			t.Fatal(err)
		}
		persisted[row.memberID] = row.statuses
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}

	playerSnapshots := map[string]openapi.RoomSnapshot{}
	for _, observer := range []nPlayerRaceParticipant{fixture.participants[0], fixture.participants[1], fixture.participants[3]} {
		resp, payload = fastRequestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/snapshot", observer.token, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("seat %d privacy snapshot: %d %s", observer.seat, resp.StatusCode, payload)
		}
		var snapshot openapi.RoomSnapshot
		if err := json.Unmarshal(payload, &snapshot); err != nil {
			t.Fatal(err)
		}
		if snapshot.Round == nil || snapshot.Round.Boards != nil || len(snapshot.Round.Opponents) != 3 {
			t.Fatalf("seat %d projected round = %+v", observer.seat, snapshot.Round)
		}
		playerSnapshots[observer.memberID] = snapshot
	}

	guessingSubject := fixture.participants[1]
	if own := playerSnapshots[guessingSubject.memberID].Round.Self.Guesses; len(own) != 1 || own[0].GuessId != wrong || len(own[0].Feedback) == 0 {
		t.Fatalf("player self board is not complete: %+v", own)
	}

	projectionSecret := []byte("integration-test-projection-secret")
	for _, observer := range []nPlayerRaceParticipant{fixture.participants[0], fixture.participants[3]} {
		snapshot := playerSnapshots[observer.memberID]
		for _, subject := range fixture.participants[1:3] {
			board := opponentBoardForMember(t, snapshot, subject.memberID)
			if len(board.Rows) != 1 || board.Rows[0].Index != 1 {
				t.Fatalf("observer seat %d subject seat %d public rows = %+v", observer.seat, subject.seat, board.Rows)
			}
			perm := multi.ColumnPermutation(projectionSecret, roundID, observer.memberID, subject.memberID, multi.ProjectionSchemaVersion, len(persisted[subject.memberID]))
			want := multi.PermuteStatuses(persisted[subject.memberID], perm)
			got := feedbackStatusesAsStrings(board.Rows[0].Statuses)
			if !slices.Equal(got, want) {
				t.Fatalf("observer seat %d subject seat %d statuses = %v, want HMAC projection %v", observer.seat, subject.seat, got, want)
			}
		}
	}

	for _, snapshot := range playerSnapshots {
		serializedOpponents, err := json.Marshal(snapshot.Round.Opponents)
		if err != nil {
			t.Fatal(err)
		}
		for _, forbidden := range [][]byte{
			[]byte(`"guessId"`), []byte(`"guessName"`), []byte(`"guessAvatarUrl"`),
			[]byte(`"field"`), []byte(`"label"`), []byte(`"symbol"`), []byte(`"displayValue"`),
			[]byte(`"permutation"`), []byte(wrong), []byte(answer), projectionSecret,
		} {
			if len(forbidden) > 0 && bytes.Contains(serializedOpponents, forbidden) {
				t.Fatalf("player opponent boards leaked %q: %s", forbidden, serializedOpponents)
			}
		}
		opponentGuessEvents := 0
		lastSequence := 0
		for _, event := range snapshot.Events {
			if event.Sequence <= lastSequence || event.OccurredAt.IsZero() {
				t.Fatalf("event order/timing is not public and monotonic: %+v", event)
			}
			lastSequence = event.Sequence
			if event.Type != string(multi.EventRoundOpponentGuess) {
				if event.Type == string(multi.EventRoundSpectatorGuess) {
					t.Fatalf("player received spectator-only event: %+v", event)
				}
				continue
			}
			opponentGuessEvents++
			assertPayloadKeys(t, event.Payload, "matchIndex", "memberId", "roundIndex", "rowIndex", "seat", "statuses")
			if event.Payload["memberId"] == snapshot.Viewer.MemberId {
				t.Fatalf("player received own canonical opponent event: %+v", event)
			}
		}
		wantEvents := 2
		if snapshot.Viewer.MemberId == guessingSubject.memberID {
			wantEvents = 1
		}
		if opponentGuessEvents != wantEvents {
			t.Fatalf("viewer %s opponent guess events = %d, want %d", snapshot.Viewer.MemberId, opponentGuessEvents, wantEvents)
		}
	}

	resp, payload = fastRequestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/snapshot", string(spectator.GuestToken), nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("spectator privacy snapshot: %d %s", resp.StatusCode, payload)
	}
	var spectatorSnapshot openapi.RoomSnapshot
	if err := json.Unmarshal(payload, &spectatorSnapshot); err != nil {
		t.Fatal(err)
	}
	if spectatorSnapshot.Round == nil || spectatorSnapshot.Round.Boards == nil || len(*spectatorSnapshot.Round.Boards) != 4 || len(spectatorSnapshot.Round.Opponents) != 0 {
		t.Fatalf("spectator projected round = %+v", spectatorSnapshot.Round)
	}
	for _, subject := range fixture.participants[1:3] {
		board := spectatorBoardForMember(t, *spectatorSnapshot.Round.Boards, subject.memberID)
		if len(board.Guesses) != 1 || board.Guesses[0].GuessId != wrong || board.Guesses[0].GuessName == "" || len(board.Guesses[0].Feedback) == 0 || len(board.Guesses[0].Feedback[0].DisplayValue) == 0 {
			t.Fatalf("spectator subject seat %d board is incomplete: %+v", subject.seat, board)
		}
	}
	spectatorGuessEvents := 0
	for _, event := range spectatorSnapshot.Events {
		if event.Type != string(multi.EventRoundSpectatorGuess) {
			continue
		}
		spectatorGuessEvents++
		guessPayload, ok := event.Payload["guess"].(map[string]any)
		if !ok || guessPayload["guessId"] != wrong || guessPayload["guessName"] == "" || guessPayload["feedback"] == nil {
			t.Fatalf("spectator guess event is incomplete: %+v", event)
		}
	}
	if spectatorGuessEvents != 2 {
		t.Fatalf("spectator guess events = %d, want 2", spectatorGuessEvents)
	}
}

func opponentBoardForMember(t *testing.T, snapshot openapi.RoomSnapshot, memberID string) openapi.OpponentBoardView {
	t.Helper()
	for _, board := range snapshot.Round.Opponents {
		if board.MemberId == memberID {
			return board
		}
	}
	t.Fatalf("opponent board for member %s not found", memberID)
	return openapi.OpponentBoardView{}
}

func spectatorBoardForMember(t *testing.T, boards []openapi.MemberBoardView, memberID string) openapi.MemberBoardView {
	t.Helper()
	for _, board := range boards {
		if board.MemberId == memberID {
			return board
		}
	}
	t.Fatalf("spectator board for member %s not found", memberID)
	return openapi.MemberBoardView{}
}

func feedbackStatusesAsStrings(statuses []openapi.FeedbackStatus) []string {
	out := make([]string, len(statuses))
	for index, status := range statuses {
		out[index] = string(status)
	}
	return out
}

func assertPayloadKeys(t *testing.T, payload map[string]any, want ...string) {
	t.Helper()
	if len(payload) != len(want) {
		t.Fatalf("payload keys = %+v, want %v", payload, want)
	}
	for _, key := range want {
		if _, ok := payload[key]; !ok {
			t.Fatalf("payload missing %s: %+v", key, payload)
		}
	}
}
