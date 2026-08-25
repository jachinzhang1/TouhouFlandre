package server_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
)

func TestMRX011RelayProjectionCapabilitiesAndHistory(t *testing.T) {
	fixture := createMatchFixtureMode(t, "bo1", "relay", 30)
	initial := startMatch(t, fixture)
	if len(initial.Events) != 0 {
		t.Fatalf("initial relay snapshot carried unbounded replay events: %d", len(initial.Events))
	}
	if initial.Match == nil || initial.Match.Relay == nil || initial.Match.Relay.CurrentStage == nil ||
		initial.Match.Relay.CurrentStage.EncounterDetails == nil ||
		len(*initial.Match.Relay.CurrentStage.EncounterDetails) != 1 {
		t.Fatalf("initial relay projection=%+v", initial.Match)
	}
	active := (*initial.Match.Relay.CurrentStage.EncounterDetails)[0]
	if initial.Match.Relay.CurrentStage.StartsAt == nil || active.StartsAt == nil ||
		!initial.Match.Relay.CurrentStage.StartsAt.Equal(*active.StartsAt) {
		t.Fatalf("relay stage startsAt=%v encounter startsAt=%v", initial.Match.Relay.CurrentStage.StartsAt, active.StartsAt)
	}
	if active.Answer != nil {
		t.Fatalf("active relay snapshot leaked answer=%+v", active.Answer)
	}
	if active.Capabilities.CanForfeit != (active.TurnMemberId != nil && *active.TurnMemberId == initial.Viewer.MemberId) {
		t.Fatalf("host forfeit capability=%+v turn=%v viewer=%s", active.Capabilities, active.TurnMemberId, initial.Viewer.MemberId)
	}

	resp, payload := fastRequestAuth(http.MethodGet,
		"/api/rooms/"+fixture.roomID+"/snapshot", fixture.joinerToken, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("joiner snapshot=%d %s", resp.StatusCode, payload)
	}
	var joiner openapi.RoomSnapshot
	if err := json.Unmarshal(payload, &joiner); err != nil {
		t.Fatal(err)
	}
	joinerDetail := (*joiner.Match.Relay.CurrentStage.EncounterDetails)[0]
	if joinerDetail.Answer != nil {
		t.Fatalf("joiner active snapshot leaked answer=%+v", joinerDetail.Answer)
	}
	if joinerDetail.Capabilities.CanGuess || joinerDetail.Capabilities.CanPass || joinerDetail.Capabilities.CanForfeit {
		t.Fatalf("non-turn capability widened=%+v", joinerDetail.Capabilities)
	}

	answer := currentAnswer(t, fixture.roomID)
	actionPath := "/api/rooms/" + fixture.roomID + "/stages/1/encounters/" + active.EncounterId + "/actions"
	resp, payload = fastRequestAuth(http.MethodPost, actionPath, fixture.hostToken, map[string]any{
		"action": "guess", "guessId": answer, "idempotencyKey": "mrx011-terminal",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("terminal action=%d %s", resp.StatusCode, payload)
	}

	resp, payload = fastRequestAuth(http.MethodGet,
		"/api/rooms/"+fixture.roomID+"/matches/0/stages?limit=1", fixture.hostToken, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("history=%d %s", resp.StatusCode, payload)
	}
	var history openapi.RoomsListRelayStageHistory200JSONResponse
	if err := json.Unmarshal(payload, &history); err != nil {
		t.Fatal(err)
	}
	if len(history.Stages) != 1 || len(history.Stages[0].Encounters) != 1 {
		t.Fatalf("history=%+v", history)
	}
	terminal := history.Stages[0].Encounters[0]
	if terminal.Answer.Id != answer || terminal.Outcome == "" || terminal.Status != openapi.RelayEncounterHistoryViewStatusEnded {
		t.Fatalf("terminal history encounter=%+v want answer=%s", terminal, answer)
	}

	resp, payload = fastRequestAuth(http.MethodGet,
		"/api/rooms/"+fixture.roomID+"/matches/0/stages?after=not-a-cursor", fixture.hostToken, nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid history cursor=%d %s", resp.StatusCode, payload)
	}
}
