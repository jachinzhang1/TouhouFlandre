package server_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
)

func TestMRX003RelayContractBoundariesRejectWithoutWrites(t *testing.T) {
	fixture := createMatchFixtureMode(t, "bo3", "relay", 60)
	startMatch(t, fixture)
	before := mrx003WriteState(t, fixture.roomID)

	responses := []struct {
		method     string
		path       string
		body       any
		wantStatus int
		wantCode   string
	}{
		{
			method: http.MethodPost, wantStatus: http.StatusNotFound, wantCode: "ENCOUNTER_NOT_FOUND",
			path: "/api/rooms/" + fixture.roomID + "/stages/1/encounters/encounter-1/actions",
			body: map[string]any{"action": "guess", "guessId": "reimu_hakurei", "idempotencyKey": "idem-1"},
		},
		{
			method: http.MethodGet, wantStatus: http.StatusOK,
			path: "/api/rooms/" + fixture.roomID + "/matches/0/stages",
		},
	}
	for _, request := range responses {
		response, payload := fastRequestAuth(request.method, request.path, fixture.hostToken, request.body)
		if response.StatusCode != request.wantStatus {
			t.Fatalf("%s %s = %d %s", request.method, request.path, response.StatusCode, payload)
		}
		if request.wantCode != "" {
			var apiError struct {
				Code string `json:"code"`
			}
			if err := json.Unmarshal(payload, &apiError); err != nil {
				t.Fatal(err)
			}
			if apiError.Code != request.wantCode {
				t.Fatalf("%s %s error = %s", request.method, request.path, apiError.Code)
			}
		} else {
			var history struct {
				Stages []json.RawMessage `json:"stages"`
			}
			if err := json.Unmarshal(payload, &history); err != nil {
				t.Fatal(err)
			}
			if history.Stages == nil {
				t.Fatalf("%s %s returned null stages: %s", request.method, request.path, payload)
			}
		}
	}

	after := mrx003WriteState(t, fixture.roomID)
	if after != before {
		t.Fatalf("feature-disabled stubs changed state: before=%+v after=%+v", before, after)
	}
}

type mrx003State struct {
	GameSequence int64
	Stages       int
	Encounters   int
	Turns        int
}

func mrx003WriteState(t *testing.T, roomID string) mrx003State {
	t.Helper()
	var state mrx003State
	if err := pool.QueryRow(ctx, `
		SELECT room.event_seq,
		       (SELECT count(*) FROM multi_relay_stage AS stage JOIN multi_match AS match ON match.id = stage.match_id WHERE match.room_id = room.id),
		       (SELECT count(*) FROM multi_relay_encounter AS encounter JOIN multi_match AS match ON match.id = encounter.match_id WHERE match.room_id = room.id),
		       (SELECT count(*) FROM multi_relay_turn AS turn_row JOIN multi_match AS match ON match.id = turn_row.match_id WHERE match.room_id = room.id)
		FROM multi_room AS room
		WHERE room.id = $1`, roomID).Scan(&state.GameSequence, &state.Stages, &state.Encounters, &state.Turns); err != nil {
		t.Fatal(err)
	}
	return state
}

func TestMRX003RelayStandingNegativeScoreJSONRoundTrip(t *testing.T) {
	want := multi.RelayStandingView{
		MemberID: "member-1", Seat: 1, Score: -3, Status: "eliminated", LifeState: multi.RelayLifeNearDeath,
	}
	data, err := json.Marshal(want)
	if err != nil {
		t.Fatal(err)
	}
	var got multi.RelayStandingView
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("relay standing round-trip = %+v, want %+v", got, want)
	}
}

func TestMRX003RelayEncounterEndedAnswerJSONRoundTrip(t *testing.T) {
	winnerID := "member-2"
	want := multi.RelayEncounterEndedPayload{
		MatchIndex: 0, StageID: "stage-1", StageIndex: 1, EncounterID: "encounter-1",
		Status: "ended", Outcome: "forfeit", WinnerMemberID: &winnerID,
		Answer: multi.AnswerView{
			ID: "reimu_hakurei", Name: "Reimu Hakurei", AvatarURL: "/avatars/reimu.png",
			WorkID: "th01", WorkTitle: "Highly Responsive to Prayers", WorkCode: "TH01",
		},
	}
	data, err := json.Marshal(want)
	if err != nil {
		t.Fatal(err)
	}
	var got multi.RelayEncounterEndedPayload
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if got.Outcome != want.Outcome || got.Answer != want.Answer || got.WinnerMemberID == nil || *got.WinnerMemberID != winnerID {
		t.Fatalf("relay encounter ended round-trip = %+v, want %+v", got, want)
	}
}
