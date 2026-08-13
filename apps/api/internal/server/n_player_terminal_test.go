package server_test

import (
	"encoding/json"
	"net/http"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
)

func TestMultiRaceRoundForfeitTerminalTable(t *testing.T) {
	t.Run("partial forfeits continue and next round restores eligibility", func(t *testing.T) {
		fixture := createNPlayerRaceFixture(t, 4, "bo3")
		forfeitRaceRound(t, fixture, fixture.participants[1], http.StatusNoContent)

		var roundStatus, forfeitedStatus string
		var activePlayers int
		if err := pool.QueryRow(ctx, `
			SELECT round.status, player.status,
			       (SELECT count(*)::int FROM multi_round_player active WHERE active.round_id = round.id AND active.status = 'active')
			FROM multi_round AS round
			JOIN multi_match AS match ON match.id = round.match_id
			JOIN multi_round_player AS player ON player.round_id = round.id AND player.member_id = $2
			WHERE match.room_id = $1 AND round.round_index = 1`, fixture.roomID, fixture.participants[1].memberID).
			Scan(&roundStatus, &forfeitedStatus, &activePlayers); err != nil {
			t.Fatal(err)
		}
		if roundStatus != string(multi.RoundStatusPlaying) || forfeitedStatus != "forfeited" || activePlayers != 3 {
			t.Fatalf("partial forfeit round=%s player=%s active=%d", roundStatus, forfeitedStatus, activePlayers)
		}

		wrong := guessableIDs(t, currentAnswer(t, fixture.roomID), 1)[0]
		resp, payload := guess(t, fixture.roomID, fixture.participants[1].token, 1, wrong, "forfeited-cannot-guess")
		if resp.StatusCode != http.StatusConflict || decodeError(t, payload).Code != "ROUND_NOT_ACTIVE" {
			t.Fatalf("forfeited guess = %d %s", resp.StatusCode, payload)
		}

		forfeitRaceRound(t, fixture, fixture.participants[0], http.StatusNoContent)
		forfeitRaceRound(t, fixture, fixture.participants[2], http.StatusNoContent)
		var winnerMemberID string
		var winnerWins int
		if err := pool.QueryRow(ctx, `
			SELECT round.winner_member_id, roster.wins
			FROM multi_round AS round
			JOIN multi_match AS match ON match.id = round.match_id
			JOIN multi_match_player AS roster ON roster.match_id = match.id AND roster.member_id = round.winner_member_id
			WHERE match.room_id = $1 AND round.round_index = 1`, fixture.roomID).Scan(&winnerMemberID, &winnerWins); err != nil {
			t.Fatal(err)
		}
		if winnerMemberID != fixture.participants[3].memberID || winnerWins != 1 {
			t.Fatalf("forfeit round winner=%s wins=%d", winnerMemberID, winnerWins)
		}

		advanceRounds(t)
		var restoredStatus string
		if err := pool.QueryRow(ctx, `
			SELECT player.status
			FROM multi_round_player AS player
			JOIN multi_round AS round ON round.id = player.round_id
			JOIN multi_match AS match ON match.id = round.match_id
			WHERE match.room_id = $1 AND round.round_index = 2 AND player.member_id = $2`, fixture.roomID, fixture.participants[1].memberID).Scan(&restoredStatus); err != nil {
			t.Fatal(err)
		}
		if restoredStatus != "active" {
			t.Fatalf("next-round eligibility = %s, want active", restoredStatus)
		}
		wrong = guessableIDs(t, currentAnswer(t, fixture.roomID), 1)[0]
		if resp, payload = guess(t, fixture.roomID, fixture.participants[1].token, 2, wrong, "restored-next-round"); resp.StatusCode != http.StatusOK {
			t.Fatalf("restored player guess = %d %s", resp.StatusCode, payload)
		}
	})

	t.Run("concurrent forfeits serialize to one active winner", func(t *testing.T) {
		fixture := createNPlayerRaceFixture(t, 4, "bo3")
		type result struct {
			status  int
			payload []byte
		}
		start := make(chan struct{})
		results := make(chan result, len(fixture.participants))
		var wg sync.WaitGroup
		for _, participant := range fixture.participants {
			participant := participant
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/rounds/1/forfeit", participant.token, nil)
				results <- result{status: resp.StatusCode, payload: payload}
			}()
		}
		close(start)
		wg.Wait()
		close(results)
		accepted, rejected := 0, 0
		for result := range results {
			switch result.status {
			case http.StatusNoContent:
				accepted++
			case http.StatusConflict:
				rejected++
				if decodeError(t, result.payload).Code != "ROUND_ENDED" {
					t.Fatalf("concurrent forfeit rejection = %s", result.payload)
				}
			default:
				t.Fatalf("concurrent forfeit = %d %s", result.status, result.payload)
			}
		}
		var active, forfeited, endedEvents, scoringPlayers int
		var winnerMemberID, activeMemberID string
		if err := pool.QueryRow(ctx, `
			SELECT
				count(*) FILTER (WHERE player.status = 'active')::int,
				count(*) FILTER (WHERE player.status = 'forfeited')::int,
				max(player.member_id) FILTER (WHERE player.status = 'active'),
				round.winner_member_id,
				(SELECT count(*)::int FROM room_event WHERE room_id = match.room_id AND type = 'round.ended'),
				(SELECT count(*)::int FROM multi_match_player roster WHERE roster.match_id = match.id AND roster.wins = 1)
			FROM multi_round AS round
			JOIN multi_match AS match ON match.id = round.match_id
			JOIN multi_round_player AS player ON player.round_id = round.id
			WHERE match.room_id = $1 AND round.round_index = 1
			GROUP BY round.winner_member_id, match.room_id, match.id`, fixture.roomID).
			Scan(&active, &forfeited, &activeMemberID, &winnerMemberID, &endedEvents, &scoringPlayers); err != nil {
			t.Fatal(err)
		}
		if accepted != 3 || rejected != 1 || active != 1 || forfeited != 3 || winnerMemberID != activeMemberID || endedEvents != 1 || scoringPlayers != 1 {
			t.Fatalf("concurrent forfeit accepted=%d rejected=%d active=%d forfeited=%d winner=%s activeMember=%s events=%d scorers=%d",
				accepted, rejected, active, forfeited, winnerMemberID, activeMemberID, endedEvents, scoringPlayers)
		}
	})
}

func TestMultiRaceMatchLeaveTerminalTable(t *testing.T) {
	fixture := createNPlayerRaceFixture(t, 4, "bo3")
	for _, participant := range fixture.participants[1:] {
		resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/leave", participant.token, nil)
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("seat %d leave = %d %s", participant.seat, resp.StatusCode, payload)
		}
		var roomStatus, matchStatus string
		var activeRoster int
		if err := pool.QueryRow(ctx, `
			SELECT room.status, match.status,
			       (SELECT count(*)::int FROM multi_match_player roster WHERE roster.match_id = match.id AND roster.status = 'active')
			FROM multi_room AS room JOIN multi_match AS match ON match.room_id = room.id
			WHERE room.id = $1`, fixture.roomID).Scan(&roomStatus, &matchStatus, &activeRoster); err != nil {
			t.Fatal(err)
		}
		if participant.seat < 4 {
			if roomStatus != "playing" || matchStatus != "playing" || activeRoster != 4-(participant.seat-1) {
				t.Fatalf("after seat %d leave room=%s match=%s active=%d", participant.seat, roomStatus, matchStatus, activeRoster)
			}
		} else if roomStatus != "finished" || matchStatus != "finished" || activeRoster != 1 {
			t.Fatalf("terminal leave room=%s match=%s active=%d", roomStatus, matchStatus, activeRoster)
		}
	}

	snapshot := nPlayerSnapshot(t, fixture.roomID, fixture.participants[0].token)
	ended := latestEventOfType(t, snapshot, string(multi.EventMatchEnded))
	if ended.Payload["winnerMemberId"] != fixture.participants[0].memberID || ended.Payload["reason"] != string(multi.MatchEndReasonForfeit) || ended.Payload["viewerResult"] != "win" {
		t.Fatalf("leave match result = %+v", ended.Payload)
	}
	for _, score := range ended.Payload["scores"].([]any) {
		if score.(map[string]any)["score"] != float64(0) {
			t.Fatalf("match-level departure changed score: %+v", ended.Payload["scores"])
		}
	}
	resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/rematch", fixture.participants[0].token, nil)
	if resp.StatusCode != http.StatusConflict || decodeError(t, payload).Code != "REMATCH_NOT_AVAILABLE" {
		t.Fatalf("incomplete roster rematch = %d %s", resp.StatusCode, payload)
	}
}

func TestMultiRacePartialLeaveContinuesWithRemainingRoster(t *testing.T) {
	fixture := createNPlayerRaceFixture(t, 4, "bo3")
	left := fixture.participants[1]
	resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/leave", left.token, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("partial leave = %d %s", resp.StatusCode, payload)
	}
	answer := currentAnswer(t, fixture.roomID)
	if resp, payload = guess(t, fixture.roomID, fixture.participants[0].token, 1, answer, "partial-leave-round-win"); resp.StatusCode != http.StatusOK {
		t.Fatalf("remaining roster round win = %d %s", resp.StatusCode, payload)
	}
	advanceRounds(t)
	var roundPlayers, leftRoundRows int
	var matchStatus string
	if err := pool.QueryRow(ctx, `
		SELECT
			(SELECT count(*)::int FROM multi_round_player player WHERE player.round_id = round.id),
			(SELECT count(*)::int FROM multi_round_player player WHERE player.round_id = round.id AND player.member_id = $2),
			match.status
		FROM multi_round AS round
		JOIN multi_match AS match ON match.id = round.match_id
		WHERE match.room_id = $1 AND round.round_index = 2`, fixture.roomID, left.memberID).
		Scan(&roundPlayers, &leftRoundRows, &matchStatus); err != nil {
		t.Fatal(err)
	}
	if roundPlayers != 3 || leftRoundRows != 0 || matchStatus != "playing" {
		t.Fatalf("next round after leave players=%d leftRows=%d match=%s", roundPlayers, leftRoundRows, matchStatus)
	}
}

func TestMultiRaceDisconnectBatchTerminalTable(t *testing.T) {
	for _, test := range []struct {
		name          string
		disconnectAll bool
		wantWinner    bool
	}{
		{name: "one survivor wins", wantWinner: true},
		{name: "all simultaneous expiries draw", disconnectAll: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture := createNPlayerRaceFixture(t, 4, "bo3")
			where := "seat <> 1"
			if test.disconnectAll {
				where = "seat IS NOT NULL"
			}
			if _, err := pool.Exec(ctx, `UPDATE multi_member
				SET status = 'disconnected', grace_until = now() - interval '1 second'
				WHERE room_id = $1 AND role = 'player' AND `+where, fixture.roomID); err != nil {
				t.Fatal(err)
			}
			if err := fastSweeper().SweepOnce(ctx); err != nil {
				t.Fatal(err)
			}
			var roomStatus, matchStatus string
			var winner pgtype.Text
			var leftRoster int
			if err := pool.QueryRow(ctx, `
				SELECT room.status, match.status, match.winner_member_id,
				       (SELECT count(*)::int FROM multi_match_player roster WHERE roster.match_id = match.id AND roster.status = 'left')
				FROM multi_room AS room JOIN multi_match AS match ON match.room_id = room.id
				WHERE room.id = $1`, fixture.roomID).Scan(&roomStatus, &matchStatus, &winner, &leftRoster); err != nil {
				t.Fatal(err)
			}
			wantLeft := 3
			if test.disconnectAll {
				wantLeft = 4
			}
			if roomStatus != "finished" || matchStatus != "finished" || leftRoster != wantLeft || winner.Valid != test.wantWinner {
				t.Fatalf("disconnect terminal room=%s match=%s winner=%+v left=%d", roomStatus, matchStatus, winner, leftRoster)
			}
			if test.wantWinner && winner.String != fixture.participants[0].memberID {
				t.Fatalf("disconnect winner = %s", winner.String)
			}
			snapshot := nPlayerSnapshot(t, fixture.roomID, fixture.participants[0].token)
			ended := latestEventOfType(t, snapshot, string(multi.EventMatchEnded))
			if ended.Payload["reason"] != string(multi.MatchEndReasonDisconnect) {
				t.Fatalf("disconnect event = %+v", ended.Payload)
			}
			if test.disconnectAll {
				if ended.Payload["winnerMemberId"] != nil || ended.Payload["viewerResult"] != "draw" {
					t.Fatalf("all-expired result = %+v", ended.Payload)
				}
			}
		})
	}
}

func TestMultiRaceGuessExhaustionTerminalTable(t *testing.T) {
	fixture := createNPlayerRaceFixture(t, 4, "bo3")
	maxGuesses := fixture.snapshot.Round.MaxGuesses
	if maxGuesses <= 0 || maxGuesses > 50 {
		t.Fatalf("test max guesses = %d", maxGuesses)
	}
	wrong := guessableIDs(t, currentAnswer(t, fixture.roomID), maxGuesses)
	for participantIndex, participant := range fixture.participants {
		for guessIndex, guessID := range wrong {
			resp, payload := guess(t, fixture.roomID, participant.token, 1, guessID,
				"exhaust-"+strconv.Itoa(participant.seat)+"-"+strconv.Itoa(guessIndex))
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("seat %d guess %d = %d %s", participant.seat, guessIndex, resp.StatusCode, payload)
			}
		}
		if participantIndex == 0 {
			var status string
			if err := pool.QueryRow(ctx, `SELECT round.status FROM multi_round round JOIN multi_match match ON match.id = round.match_id WHERE match.room_id = $1`, fixture.roomID).Scan(&status); err != nil {
				t.Fatal(err)
			}
			if status != "playing" {
				t.Fatalf("partial exhaustion ended round: %s", status)
			}
			resp, payload := guess(t, fixture.roomID, participant.token, 1, wrong[0], "exhaust-over-limit")
			if resp.StatusCode != http.StatusConflict || decodeError(t, payload).Code != "GUESS_LIMIT_REACHED" {
				t.Fatalf("over-limit guess = %d %s", resp.StatusCode, payload)
			}
		}
	}
	var roundStatus string
	var winner pgtype.Text
	var endedEvents int
	if err := pool.QueryRow(ctx, `
		SELECT round.status, round.winner_member_id,
		       (SELECT count(*)::int FROM room_event WHERE room_id = match.room_id AND type = 'round.ended')
		FROM multi_round AS round JOIN multi_match AS match ON match.id = round.match_id
		WHERE match.room_id = $1`, fixture.roomID).Scan(&roundStatus, &winner, &endedEvents); err != nil {
		t.Fatal(err)
	}
	if roundStatus != "ended" || winner.Valid || endedEvents != 1 {
		t.Fatalf("all-exhausted terminal status=%s winner=%+v events=%d", roundStatus, winner, endedEvents)
	}
}

func TestMultiRaceTimeoutAndRestartTerminalTable(t *testing.T) {
	t.Run("round timeout draws after a partial forfeit", func(t *testing.T) {
		fixture := createNPlayerRaceFixture(t, 4, "bo3")
		forfeitRaceRound(t, fixture, fixture.participants[1], http.StatusNoContent)
		if _, err := pool.Exec(ctx, `UPDATE multi_round SET deadline = now() - interval '1 second'
			WHERE match_id = (SELECT id FROM multi_match WHERE room_id = $1 AND status = 'playing')`, fixture.roomID); err != nil {
			t.Fatal(err)
		}
		if err := fastSweeper().SweepOnce(ctx); err != nil {
			t.Fatal(err)
		}
		var status string
		var winner pgtype.Text
		if err := pool.QueryRow(ctx, `SELECT round.status, round.winner_member_id FROM multi_round round JOIN multi_match match ON match.id = round.match_id WHERE match.room_id = $1`, fixture.roomID).Scan(&status, &winner); err != nil {
			t.Fatal(err)
		}
		if status != "ended" || winner.Valid {
			t.Fatalf("timeout round status=%s winner=%+v", status, winner)
		}
		snapshot := nPlayerSnapshot(t, fixture.roomID, fixture.participants[0].token)
		ended := latestEventOfType(t, snapshot, string(multi.EventRoundEnded))
		if ended.Payload["winnerMemberId"] != nil || ended.Payload["viewerResult"] != "draw" || len(ended.Payload["scores"].([]any)) != 4 {
			t.Fatalf("timeout projected event = %+v", ended.Payload)
		}
	})

	t.Run("restart preserves roster scores and ends without winner", func(t *testing.T) {
		fixture := createNPlayerRaceFixture(t, 4, "bo3")
		answer := currentAnswer(t, fixture.roomID)
		if resp, payload := guess(t, fixture.roomID, fixture.participants[1].token, 1, answer, "restart-score"); resp.StatusCode != http.StatusOK {
			t.Fatalf("pre-restart score = %d %s", resp.StatusCode, payload)
		}
		advanceRounds(t)
		if _, err := multi.TerminateActiveMatches(ctx, pool, time.Now(), fastTiming); err != nil {
			t.Fatal(err)
		}
		var status string
		var winner pgtype.Text
		var seatTwoWins int
		if err := pool.QueryRow(ctx, `
			SELECT match.status, match.winner_member_id, roster.wins
			FROM multi_match AS match
			JOIN multi_match_player AS roster ON roster.match_id = match.id AND roster.seat = 2
			WHERE match.room_id = $1`, fixture.roomID).Scan(&status, &winner, &seatTwoWins); err != nil {
			t.Fatal(err)
		}
		if status != "finished" || winner.Valid || seatTwoWins != 1 {
			t.Fatalf("restart terminal status=%s winner=%+v seat2Wins=%d", status, winner, seatTwoWins)
		}
		snapshot := nPlayerSnapshot(t, fixture.roomID, fixture.participants[0].token)
		ended := latestEventOfType(t, snapshot, string(multi.EventMatchEnded))
		seatTwoScore := collectionEntryAtSeat(t, ended.Payload, "scores", 2)
		if ended.Payload["reason"] != string(multi.MatchEndReasonServerRestart) || ended.Payload["winnerMemberId"] != nil || ended.Payload["viewerResult"] != "draw" || seatTwoScore["score"] != float64(1) {
			t.Fatalf("restart projected event = %+v", ended.Payload)
		}
	})
}

func forfeitRaceRound(t *testing.T, fixture nPlayerRaceFixture, participant nPlayerRaceParticipant, wantStatus int) {
	t.Helper()
	resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/rounds/1/forfeit", participant.token, nil)
	if resp.StatusCode != wantStatus {
		t.Fatalf("seat %d forfeit = %d %s, want %d", participant.seat, resp.StatusCode, payload, wantStatus)
	}
}

func nPlayerSnapshot(t *testing.T, roomID, token string) openapi.RoomSnapshot {
	t.Helper()
	resp, payload := fastRequestAuth(http.MethodGet, "/api/rooms/"+roomID+"/snapshot", token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("N-player snapshot = %d %s", resp.StatusCode, payload)
	}
	var snapshot openapi.RoomSnapshot
	if err := json.Unmarshal(payload, &snapshot); err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func latestEventOfType(t *testing.T, snapshot openapi.RoomSnapshot, eventType string) openapi.RoomEventEnvelope {
	t.Helper()
	for index := len(snapshot.Events) - 1; index >= 0; index-- {
		if snapshot.Events[index].Type == eventType {
			return snapshot.Events[index]
		}
	}
	t.Fatalf("event %s not found", eventType)
	return openapi.RoomEventEnvelope{}
}
